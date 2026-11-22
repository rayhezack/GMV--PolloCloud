import { executeCompleteResult } from '../maxcompute/complete-result.ts';
import type { MaxComputeQueryResult } from '../maxcompute/result-types';

export interface AnalyticsBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface AnalyticsEnv {
  ANALYTICS?: AnalyticsBinding;
}

const MAXCOMPUTE_PAGE_SIZE = 10_000;
const MAXCOMPUTE_WAIT_SECONDS = [1, 2, 5, 10, 10, 10, 15, 15, 15, 20, 20, 30, 30] as const;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function nestedPayload(value: unknown): JsonObject {
  const object = asObject(value);
  const data = asObject(object.data);
  return Object.keys(data).length ? data : object;
}

function readColumns(value: unknown): string[] {
  const object = nestedPayload(value);
  const raw = object.column_names ?? object.columns ?? object.schema;
  if (!Array.isArray(raw)) return [];
  return raw.map((column) => {
    if (typeof column === 'string') return column;
    const item = asObject(column);
    return String(item.name ?? item.column_name ?? item.key ?? '');
  }).filter(Boolean);
}

function readRows(value: unknown): unknown[] {
  const object = nestedPayload(value);
  if (Array.isArray(object.rows)) return object.rows;
  if (Array.isArray(object.result)) return object.result;
  if (Array.isArray(object.data)) return object.data;
  return [];
}

function normalizeResult(value: unknown, previousColumns: string[] = []): MaxComputeQueryResult {
  const rawRows = readRows(value);
  const columns = readColumns(value);
  const firstObject = rawRows.find((row) => row && typeof row === 'object' && !Array.isArray(row));
  const objectColumns = firstObject
    ? [...new Set(rawRows.flatMap((row) => Object.keys(asObject(row))))]
    : [];
  const columnNames = previousColumns.length
    ? previousColumns
    : columns.length
      ? columns
      : objectColumns;
  const rows = rawRows.map((row) => {
    if (Array.isArray(row)) return row;
    const object = asObject(row);
    if (Array.isArray(object.values)) return object.values;
    return columnNames.map((column) => object[column]);
  });
  return { column_names: columnNames, rows };
}

function readValue(value: unknown, ...keys: string[]): unknown {
  const object = nestedPayload(value);
  for (const key of keys) {
    if (object[key] != null) return object[key];
  }
  return undefined;
}

function readInstanceId(value: unknown): string {
  const instanceId = readValue(value, 'instance_id', 'instanceId', 'id');
  if (!instanceId) throw new Error('ANALYTICS MaxCompute 提交响应缺少 instance_id');
  return String(instanceId);
}

function readStatus(value: unknown): string {
  return String(readValue(value, 'status', 'state', 'job_status', 'task_status') ?? '').toLowerCase();
}

function isSuccessfulStatus(status: string): boolean {
  return ['terminated', 'success', 'succeeded', 'completed', 'complete'].includes(status);
}

function isFailedStatus(status: string): boolean {
  return ['failed', 'failure', 'cancelled', 'canceled', 'error'].includes(status);
}

function hasExplicitFailure(value: unknown): boolean {
  const flag = readValue(value, 'successful', 'success', 'succeeded');
  return flag === false || flag === 0 || flag === 'false';
}

function describeBody(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return (serialized ?? String(value)).slice(0, 1000);
  } catch {
    return String(value);
  }
}

function readOnlySql(sql: string): string {
  let query = sql.trim();
  for (;;) {
    const setting = /^SET\s+[^;]+;\s*/i.exec(query);
    if (!setting) return query;
    query = query.slice(setting[0].length).trim();
  }
}

export class AnalyticsClient {
  private readonly env: AnalyticsEnv;

  constructor(env: AnalyticsEnv) {
    this.env = env;
  }

  async holoQuery(sql: string, params: unknown[] = []): Promise<MaxComputeQueryResult> {
    return normalizeResult(await this.request('/v1/hologres/query', {
      method: 'POST',
      body: JSON.stringify({ sql, params }),
    }));
  }

  async executeSql(sql: string): Promise<MaxComputeQueryResult> {
    const submitted = await this.request('/v1/maxcompute/jobs', {
      method: 'POST',
      body: JSON.stringify({ sql: readOnlySql(sql) }),
    });
    const instanceId = encodeURIComponent(readInstanceId(submitted));
    let completed = false;
    let lastStatus = '';

    for (const seconds of MAXCOMPUTE_WAIT_SECONDS) {
      await this.sleep(seconds * 1000);
      const job = await this.request(`/v1/maxcompute/jobs/${instanceId}`);
      lastStatus = readStatus(job);
      if (hasExplicitFailure(job)) {
        throw new Error(`ANALYTICS MaxCompute 作业失败：${describeBody(job)}`);
      }
      if (isSuccessfulStatus(lastStatus)) {
        completed = true;
        break;
      }
      if (isFailedStatus(lastStatus)) {
        throw new Error(`ANALYTICS MaxCompute 作业失败：${describeBody(job)}`);
      }
    }
    if (!completed) throw new Error(`ANALYTICS MaxCompute 作业 ${decodeURIComponent(instanceId)} 超时未结束（状态：${lastStatus || '未知'}）`);

    const rows: unknown[][] = [];
    let columns: string[] = [];
    for (let offset = 0; ; offset += MAXCOMPUTE_PAGE_SIZE) {
      const page = normalizeResult(
        await this.fetchResultPage(instanceId, offset),
        columns,
      );
      if (!columns.length) columns = page.column_names;
      rows.push(...page.rows);
      if (page.rows.length < MAXCOMPUTE_PAGE_SIZE) break;
    }
    return { column_names: columns, rows };
  }

  async executeCompleteSql(sql: string): Promise<MaxComputeQueryResult> {
    return executeCompleteResult(sql, (query) => this.executeSql(query));
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!this.env.ANALYTICS) throw new Error('ANALYTICS 内网数据绑定未配置，请重新发布应用');
    const response = await this.env.ANALYTICS.fetch(`https://data${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`ANALYTICS ${path} ${response.status}: ${describeBody(body)}`);
    return body;
  }

  private async fetchResultPage(instanceId: string, offset: number): Promise<unknown> {
    const path = `/v1/maxcompute/jobs/${instanceId}/result?offset=${offset}&limit=${MAXCOMPUTE_PAGE_SIZE}`;
    const retryWaits = [0, 1_000, 2_000, 5_000, 10_000, 15_000, 20_000, 30_000];
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.request(path);
      } catch (error) {
        const message = String(error);
        const retryable = message.includes(' 409:') && message.includes('NOT_READY');
        if (!retryable) throw error;
        if (attempt >= retryWaits.length - 1) {
          const job = await this.request(`/v1/maxcompute/jobs/${instanceId}`);
          throw new Error(`${message}；最终作业状态：${describeBody(job)}`);
        }
        await this.sleep(retryWaits[attempt + 1]);
      }
    }
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
