import { createHmac, randomUUID } from 'node:crypto';

export interface MaxComputeConnection {
  endpoint: string;
  project: string;
  accessKeyId: string;
  accessKeySecret: string;
}

export interface MaxComputeQueryResult {
  column_names: string[];
  rows: unknown[][];
}

const CONTENT_TYPE = 'application/xml';
const DEFAULT_QUERY_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 60_000;
const REQUEST_MAX_ATTEMPTS = 3;
const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class MaxComputeClient {
  constructor(private readonly connection: MaxComputeConnection) {}

  async executeSql(sql: string): Promise<MaxComputeQueryResult> {
    const instanceUrl = await this.submit(sql);
    await this.waitForSuccess(instanceUrl);
    return this.readResult(instanceUrl);
  }

  private async submit(sql: string): Promise<string> {
    const collectionUrl = this.buildUrl(
      `/projects/${encodeURIComponent(this.connection.project)}/instances`,
    );
    const response = await this.request(collectionUrl, {
      method: 'POST',
      body: this.buildJobXml(sql),
      headers: { 'Content-Type': CONTENT_TYPE },
    });
    const location = response.headers.get('location');
    if (!location) {
      throw new Error('MaxCompute 提交成功但响应缺少 Location 实例地址');
    }
    return new URL(location, collectionUrl).toString();
  }

  private async waitForSuccess(instanceUrl: string): Promise<void> {
    const timeoutMs = this.readQueryTimeout();
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const response = await this.request(
        this.withCurrentProject(instanceUrl),
        {
          method: 'GET',
        },
      );
      const xml = await response.text();
      const status = this.readTag(xml, 'Status');

      if (status === 'Terminated') {
        const taskStatus = this.readTaskStatus(xml);
        if (!taskStatus || taskStatus === 'SUCCESS') return;
        throw new Error(
          `MaxCompute SQL 执行失败（${taskStatus}）：${this.readErrorMessage(xml)}`,
        );
      }

      if (status && status !== 'Running' && status !== 'Suspended') {
        throw new Error(`MaxCompute 返回未知实例状态：${status}`);
      }
      await this.sleep(POLL_INTERVAL_MS);
    }

    throw new Error(
      `MaxCompute SQL 执行超时（${Math.round(timeoutMs / 1000)} 秒）`,
    );
  }

  private async readResult(
    instanceUrl: string,
  ): Promise<MaxComputeQueryResult> {
    const resultUrl = this.withCurrentProject(`${instanceUrl}?result`);
    const response = await this.request(resultUrl, { method: 'GET' });
    const xml = await response.text();
    const taskStatus = this.readTaskStatus(xml);
    const rawResult = this.readResultNode(xml);

    if (taskStatus && taskStatus !== 'SUCCESS') {
      throw new Error(
        `MaxCompute SQL 执行失败（${taskStatus}）：${rawResult || this.readErrorMessage(xml)}`,
      );
    }

    const descriptorColumns = this.readColumns(xml);
    const parsedRows = this.parseCsv(rawResult);
    const hasCsvHeader =
      parsedRows.length > 0 &&
      (!descriptorColumns ||
        parsedRows[0].every(
          (value, index) => String(value) === descriptorColumns[index],
        ));
    const columns = descriptorColumns ?? parsedRows[0]?.map(String) ?? [];
    const rows = hasCsvHeader ? parsedRows.slice(1) : parsedRows;
    if (columns.length === 0) {
      throw new Error('MaxCompute 查询结果缺少列信息');
    }
    if (rows.some((row) => row.length !== columns.length)) {
      throw new Error('MaxCompute 查询结果列数与 ResultDescriptor 不一致');
    }
    return { column_names: columns, rows };
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const requestUrl = new URL(url);
    const date = new Date().toUTCString();
    const headers = new Headers(init.headers);
    headers.set('Date', date);
    headers.set(
      'Authorization',
      this.buildAuthorization(init.method ?? 'GET', requestUrl, headers, date),
    );

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(requestUrl, {
          ...init,
          headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (response.ok) return response;

        const body = await response.text();
        const requestId = response.headers.get('x-odps-request-id');
        const suffix = requestId ? `，requestId=${requestId}` : '';
        lastError = new Error(
          `MaxCompute HTTP ${response.status}${suffix}：${this.readErrorMessage(body)}`,
        );

        if (!this.isRetryableHttpStatus(response.status)) break;
      } catch (error) {
        lastError = new Error(
          `MaxCompute 网络请求失败：${this.formatRequestError(error)}`,
        );
      }

      if (attempt < REQUEST_MAX_ATTEMPTS) {
        await this.sleep(this.retryDelayMs(attempt));
      }
    }

    throw lastError ?? new Error('MaxCompute 请求失败：未知错误');
  }

  private isRetryableHttpStatus(status: number): boolean {
    return RETRYABLE_HTTP_STATUS.has(status);
  }

  private retryDelayMs(attempt: number): number {
    return attempt * 1000;
  }

  private formatRequestError(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    const cause = (error as { cause?: unknown }).cause;
    const causeMessage = this.formatErrorCause(cause);
    return causeMessage ? `${error.message}（cause=${causeMessage}）` : error.message;
  }

  private formatErrorCause(cause: unknown): string {
    if (!cause || typeof cause !== 'object') return '';
    const detail = cause as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
    };
    const label =
      typeof detail.code === 'string' && detail.code
        ? detail.code
        : typeof detail.name === 'string' && detail.name
          ? detail.name
          : '';
    const message = typeof detail.message === 'string' ? detail.message : '';
    if (label && message) return `${label}: ${message}`;
    return label || message;
  }

  private buildAuthorization(
    method: string,
    url: URL,
    headers: Headers,
    date: string,
  ): string {
    const canonicalResource = this.buildCanonicalResource(url);
    const odpsHeaders = [...headers.entries()]
      .map(([key, value]) => [key.toLowerCase(), value] as const)
      .filter(([key]) => key.startsWith('x-odps-'))
      .sort(([left], [right]) => left.localeCompare(right));
    const signedHeaders = [
      ['content-md5', headers.get('content-md5') ?? ''],
      ['content-type', headers.get('content-type') ?? ''],
      ['date', date],
      ...odpsHeaders,
    ].sort(([left], [right]) => left.localeCompare(right));
    const canonical = [
      method.toUpperCase(),
      ...signedHeaders.map(([key, value]) =>
        key.startsWith('x-odps-') ? `${key}:${value}` : value,
      ),
      canonicalResource,
    ].join('\n');

    const region = this.readRegion();
    const dateKey = new Date(date)
      .toISOString()
      .slice(0, 10)
      .replace(/-/gu, '');
    const prefix = 'aliyun_v4';
    const secret = `${prefix}${this.connection.accessKeySecret}`;
    const dateSignature = createHmac('sha256', secret).update(dateKey).digest();
    const regionSignature = createHmac('sha256', dateSignature)
      .update(region)
      .digest();
    const serviceSignature = createHmac('sha256', regionSignature)
      .update('odps')
      .digest();
    const signingKey = createHmac('sha256', serviceSignature)
      .update(`${prefix}_request`)
      .digest();
    const signature = createHmac('sha1', signingKey)
      .update(canonical)
      .digest('base64');
    const credential = [
      this.connection.accessKeyId,
      dateKey,
      region,
      'odps',
      `${prefix}_request`,
    ].join('/');
    return `ODPS ${credential}:${signature}`;
  }

  private buildCanonicalResource(url: URL): string {
    const params = [...url.searchParams.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const query = params
      .map(([key, value]) => (value === '' ? key : `${key}=${value}`))
      .join('&');
    const endpointPath = new URL(this.normalizedEndpoint()).pathname.replace(
      /\/$/u,
      '',
    );
    const path = decodeURIComponent(url.pathname).slice(endpointPath.length);
    return query ? `${path}?${query}` : path;
  }

  private buildJobXml(sql: string): string {
    const normalizedSql = sql.trim().endsWith(';')
      ? sql.trim()
      : `${sql.trim()};`;
    const settings = JSON.stringify({
      'odps.sql.submit.mode': 'script',
      'odps.sql.type.system.odps2': 'true',
    });
    return `<?xml version="1.0" encoding="utf-8"?>
<Instance>
  <Job>
    <Priority>9</Priority>
    <Tasks>
      <SQL>
        <Name>AnonymousSQLTask</Name>
        <Config>
          <Property><Name>settings</Name><Value>${this.escapeXml(settings)}</Value></Property>
          <Property><Name>uuid</Name><Value>${randomUUID()}</Value></Property>
        </Config>
        <Query><![CDATA[${normalizedSql.replace(/\]\]>/gu, ']]]]><![CDATA[>')}]]></Query>
      </SQL>
    </Tasks>
    <DAG><RunMode>Sequence</RunMode></DAG>
  </Job>
</Instance>`;
  }

  private readColumns(xml: string): string[] | undefined {
    const rawDescriptor = this.readTag(xml, 'ResultDescriptor');
    if (!rawDescriptor) return undefined;
    try {
      const descriptor = JSON.parse(rawDescriptor) as {
        Schema?: { Columns?: Array<{ Name?: unknown }> };
      };
      const columns = (descriptor.Schema?.Columns ?? [])
        .map((column) => String(column.Name ?? ''))
        .filter(Boolean);
      if (columns.length === 0) {
        throw new Error('Schema.Columns 为空');
      }
      return columns;
    } catch (error) {
      throw new Error(
        `MaxCompute ResultDescriptor 解析失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private readResultNode(xml: string): string {
    const match = /<Result(?:\s([^>]*))?>([\s\S]*?)<\/Result>/u.exec(xml);
    if (!match) return '';
    const attributes = match[1] ?? '';
    const value = this.decodeXml(match[2].trim());
    return /\bTransform=["']Base64["']/iu.test(attributes)
      ? Buffer.from(value, 'base64').toString('utf8')
      : value;
  }

  private readTaskStatus(xml: string): string | undefined {
    const task = /<Task(?:\s[^>]*)?>([\s\S]*?)<\/Task>/u.exec(xml)?.[1];
    return task ? this.readTag(task, 'Status')?.toUpperCase() : undefined;
  }

  private readTag(xml: string, tag: string): string | undefined {
    const match = new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
      'u',
    ).exec(xml);
    return match ? this.decodeXml(match[1].trim()) : undefined;
  }

  private readErrorMessage(body: string): string {
    return (
      this.readTag(body, 'Message') ??
      this.readTag(body, 'Result') ??
      body.trim().slice(0, 1000) ??
      '未知错误'
    );
  }

  private decodeXml(value: string): string {
    const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/u.exec(value);
    if (cdata) return cdata[1];
    return value
      .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) =>
        String.fromCodePoint(Number.parseInt(hex, 16)),
      )
      .replace(/&#(\d+);/gu, (_, number: string) =>
        String.fromCodePoint(Number.parseInt(number, 10)),
      )
      .replace(/&quot;/gu, '"')
      .replace(/&apos;/gu, "'")
      .replace(/&lt;/gu, '<')
      .replace(/&gt;/gu, '>')
      .replace(/&amp;/gu, '&');
  }

  private parseCsv(input: string): unknown[][] {
    if (!input.trim()) return [];
    const rows: unknown[][] = [];
    let row: unknown[] = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < input.length; index += 1) {
      const character = input[index];
      if (quoted) {
        if (character === '"' && input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          field += character;
        }
      } else if (character === '"') {
        quoted = true;
      } else if (character === ',') {
        row.push(field === '\\N' ? null : field);
        field = '';
      } else if (character === '\n') {
        row.push(field === '\\N' ? null : field);
        rows.push(row);
        row = [];
        field = '';
      } else if (character !== '\r') {
        field += character;
      }
    }
    if (field || row.length > 0) {
      row.push(field === '\\N' ? null : field);
      rows.push(row);
    }
    return rows;
  }

  private buildUrl(path: string): string {
    return this.withCurrentProject(`${this.normalizedEndpoint()}${path}`);
  }

  private withCurrentProject(url: string): string {
    const [base, query = ''] = url.split('?', 2);
    const currentProject = `curr_project=${encodeURIComponent(this.connection.project)}`;
    return `${base}?${query ? `${query}&` : ''}${currentProject}`;
  }

  private normalizedEndpoint(): string {
    return this.connection.endpoint.replace(/\/$/u, '');
  }

  private readRegion(): string {
    const host = new URL(this.normalizedEndpoint()).hostname;
    return (
      /^service\.([^.]+)\.(?:maxcompute|odps)\.aliyun(?:-inc)?\.com$/iu.exec(
        host,
      )?.[1] ?? 'cn'
    );
  }

  private readQueryTimeout(): number {
    const configured = Number(process.env.MAXCOMPUTE_QUERY_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_QUERY_TIMEOUT_MS;
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;')
      .replace(/"/gu, '&quot;')
      .replace(/'/gu, '&apos;');
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
