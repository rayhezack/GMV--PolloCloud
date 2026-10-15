import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

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
    { maxBuffer: 128 * 1024 * 1024, timeout: 120_000 },
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
  return {
    name: 'remote-d1-dev-proxy',
    configureServer(server) {
      let workerPromise;
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
          response.end(JSON.stringify({ error: '本地开发代理仅支持读取远程 Pollo DA 数据' }));
          return;
        }

        try {
          const worker = await loadWorker();
          const body = request.body ? await new Response(request.body).arrayBuffer() : undefined;
          const workerResponse = await worker.default.fetch(
            new Request(`http://localhost${request.url}`, {
              method: request.method,
              headers: request.headers,
              body,
            }),
            { DB: remoteDatabase() },
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
