import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { localDatabase } from './local-d1.mjs';

const OWNER_ID = 'ou_e74ecf33d6000a25a1193eec73cb1ac9';

async function writeResponse(nodeResponse, response) {
  nodeResponse.statusCode = response.status;
  response.headers.forEach((value, key) => nodeResponse.setHeader(key, value));
  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}

export function remoteD1DevProxy() {
  const snapshotPath = path.resolve('.local-data/dashboard.sqlite');
  const manifestPath = path.resolve('.local-data/manifest.json');
  const demo = process.env.VITE_DATA_MODE === 'demo';
  const local = !demo && existsSync(snapshotPath) && existsSync(manifestPath);
  const window = local ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  return {
    name: 'remote-d1-dev-proxy',
    config(_, { command }) {
      return { define: {
        'import.meta.env.VITE_LOCAL_DATA_WINDOW': JSON.stringify(command === 'serve' && window ? { startDate: window.startDate, endDate: window.endDate } : null),
        'import.meta.env.VITE_LOCAL_REVENUE_WINDOW': JSON.stringify(command === 'serve' && window ? { startDate: window.revenueHistoryStartDate ?? window.startDate, endDate: window.endDate } : null),
      } };
    },
    configureServer(server) {
      const database = local ? localDatabase(snapshotPath) : null;
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
        if (!database) {
          response.statusCode = 503;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ error: '本地快照不可用；请使用 demo 模式。远程查询已禁用。' }));
          return;
        }
        if (request.method !== 'GET') {
          response.statusCode = 405;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ error: '本地开发代理仅支持读取 Pollo DA 数据' }));
          return;
        }

        try {
          if (local && url.pathname.startsWith('/api/dashboard/')) {
            const supportsHistory = ['/api/dashboard/overview','/api/dashboard/payment-trend'].includes(url.pathname);
            const coverageStart = supportsHistory && (window.revenueBaselineStartDate ?? window.revenueHistoryStartDate) || window.startDate;
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
