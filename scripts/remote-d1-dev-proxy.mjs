import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { localDatabase } from './local-d1.mjs';

const execFileAsync = promisify(execFile);
const APP_NAME = 'pollo-ai';
const OWNER_ID = 'ou_e74ecf33d6000a25a1193eec73cb1ac9';

function sqlValue(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function bindSql(sql, values) {
  let index = 0;
  let quoted = false;
  let result = '';
  for (let cursor = 0; cursor < sql.length; cursor += 1) {
    const char = sql[cursor];
    if (char === "'") {
      if (quoted && sql[cursor + 1] === "'") {
        result += "''";
        cursor += 1;
        continue;
      }
      quoted = !quoted;
      result += char;
      continue;
    }
    if (char === '?' && !quoted) {
      if (index >= values.length) throw new Error('D1 查询参数数量不足');
      result += sqlValue(values[index]);
      index += 1;
      continue;
    }
    result += char;
  }
  if (index !== values.length) throw new Error('D1 查询参数数量过多');
  return result;
}

async function executeRemoteSql(sql) {
  const { stdout } = await execFileAsync(
    'pollocloud',
    ['db', 'execute', '--name', APP_NAME, '--command', sql, '--json'],
    { maxBuffer: 128 * 1024 * 1024, timeout: 120_000, env: { ...process.env, NODE_USE_ENV_PROXY: '1' } },
  );
  const jsonStart = stdout.indexOf('[');
  if (jsonStart < 0) throw new Error('远程 D1 返回格式异常');
  const payload = JSON.parse(stdout.slice(jsonStart))[0];
  if (!payload.success) throw new Error('远程 D1 查询失败');
  return payload.results ?? [];
}

function remoteDatabase() {
  const prepare = (sql) => {
    let boundSql = sql;
    return {
      bind(...values) {
        boundSql = bindSql(sql, values);
        return this;
      },
      async all() {
        return { results: await executeRemoteSql(boundSql) };
      },
      async first() {
        // Development uses the Worker's memory cache. This read-only proxy
        // cannot populate the shared response cache, so don't pay a remote
        // round trip for a cache entry produced by a different code version.
        if (/\bFROM\s+dashboard_response_cache\b/i.test(boundSql)) return null;
        const results = await executeRemoteSql(boundSql);
        return results[0] ?? null;
      },
      async run() {
        throw new Error('本地开发代理仅允许读取远程 D1');
      },
    };
  };
  return { prepare };
}

async function writeResponse(nodeResponse, response) {
  nodeResponse.statusCode = response.status;
  response.headers.forEach((value, key) => nodeResponse.setHeader(key, value));
  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}

export function remoteD1DevProxy() {
  const snapshotPath = path.resolve('.local-data/dashboard.sqlite');
  const manifestPath = path.resolve('.local-data/manifest.json');
  const local = process.env.POLLO_REMOTE_DATA !== '1' && existsSync(snapshotPath) && existsSync(manifestPath);
  const window = local ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  return {
    name: 'remote-d1-dev-proxy',
    config(_, { command }) {
      return { define: {
        'import.meta.env.VITE_LOCAL_DATA_WINDOW': JSON.stringify(command === 'serve' && window ? { startDate: window.startDate, endDate: window.endDate } : null),
      } };
    },
    configureServer(server) {
      const database = local ? localDatabase(snapshotPath) : remoteDatabase();
      if (local) {
        server.config.logger.info(`本地只读数据：${window.startDate} ~ ${window.endDate}`);
        server.httpServer?.once('close', () => database.close());
      }
      let workerPromise;
      if (local) server.watcher.add(manifestPath);
      server.watcher.on('change', (file) => {
        if (local && path.resolve(file) === manifestPath) void server.restart();
        if (file.includes('/worker/') || file.includes('/server/modules/maxcompute/')) workerPromise = undefined;
      });
      const loadWorker = () => {
        workerPromise ??= server.ssrLoadModule(path.resolve('worker/index.ts'));
        return workerPromise;
      };

      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname === '/_pollocloud/me') {
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ userId: OWNER_ID, userName: 'Ray（本地只读）', role: 'viewer' }));
          return;
        }
        if (!url.pathname.startsWith('/api/')) {
          next();
          return;
        }
        if (request.method !== 'GET') {
          response.statusCode = 405;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ error: '本地开发代理仅支持读取 Pollo DA 数据' }));
          return;
        }

        try {
          // Optional verified Base export for local UI review, never shipped to production.
          const actionsPath = path.resolve('.local-data/product-actions.json');
          if (url.pathname === '/api/dashboard/product-actions' && existsSync(actionsPath)) {
            response.setHeader('content-type', 'application/json');
            response.setHeader('cache-control', 'no-store');
            response.end(readFileSync(actionsPath));
            return;
          }
          if (local && url.pathname.startsWith('/api/dashboard/')) {
            const supportsHistory = ['/api/dashboard/overview','/api/dashboard/payment-trend'].includes(url.pathname);
            const coverageStart = supportsHistory && window.revenueHistoryStartDate || window.startDate;
            const requestedStart = url.searchParams.get('startDate');
            url.searchParams.set('startDate', requestedStart ? [coverageStart,requestedStart].sort().at(-1) : window.startDate);
            const requestedEnd = url.searchParams.get('endDate');
            // Preserve independent table week/range filters, within coverage.
            url.searchParams.set('endDate', requestedEnd ? [requestedEnd,window.endDate].sort()[0] : window.endDate);
          }
          const worker = await loadWorker();
          const body = request.body ? await new Response(request.body).arrayBuffer() : undefined;
          const workerResponse = await worker.default.fetch(
            new Request(url, {
              method: request.method,
              headers: request.headers,
              body,
            }),
            { DB: database },
            { waitUntil: (promise) => void promise.catch(() => undefined) },
          );
          await writeResponse(response, workerResponse);
        } catch (error) {
          response.statusCode = 500;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  };
}
