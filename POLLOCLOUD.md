# Pollo Cloud deployment

The dashboard builds as a Pollo Cloud SPA. Its Worker reads analytical data from the Pollo DA D1 tables and pulls new daily facts from MaxCompute into D1. Feishu Base remains only for task records consumed by the notification bot:

```bash
npm ci
npm run build
pollocloud login
pollocloud db execute --name pollo-ai --file db/0002_dashboard_response_cache.sql
pollocloud db execute --name pollo-ai --file db/0003_report_jobs.sql
pollocloud db execute --name pollo-ai --file db/0006_sync_staging.sql
pollocloud db execute --name pollo-ai --file db/0007_paused_job_indexes.sql
pollocloud db execute --name pollo-ai --file db/0008_sync_staging_chunks.sql
pollocloud db execute --name pollo-ai --file db/0009_pollo_da_analytics.sql
pollocloud deploy
```

`npm run build` writes `dist/index.html` and hashed files under `dist/assets`. The checked-in `pollocloud.json` enables SPA fallback and registers `worker/index.ts`.

The browser uses same-origin `/api/*` routes served by the Worker. Pollo Cloud's `/_pollocloud/me` and `/_pollocloud/logout` endpoints provide account context. The Worker obtains a Feishu tenant token server-side, so app credentials are never sent to the browser.

Configure these Pollo Cloud secrets before deployment:

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
MAXCOMPUTE_ENDPOINT
MAXCOMPUTE_PROJECT
MAXCOMPUTE_ACCESS_KEY_ID
MAXCOMPUTE_ACCESS_KEY_SECRET
KIMI_API_KEY
```

The Feishu app must have record read/write API scopes and document-level access to Base `OjCAbXDNbavIU9seAzVcqUHanHg`. Record reads, creates, updates, and deletes have all been verified against this Base.

Dashboard endpoints push platform and date filters into D1, merge identical in-flight reads, and cache successful responses in the app's D1 database for ten minutes. An expired response can be served for up to one hour while D1 refreshes in the background. `POST /api/sync-runs` stages each MaxCompute query result in D1. Only after every query succeeds does the Worker replace the matching `web` and `app` rows in the four `pollo_da_fact_rows` datasets and clear the response cache.

The one-time migration uses `db/0009_pollo_da_analytics.sql`, then imports the Base snapshot into `pollo_da_base_records`, daily facts into `pollo_da_fact_rows`, reports into `pollo_da_reports`, and product actions into `pollo_da_product_actions`. The existing D1 database is bound to the `pollo-ai` app; the `pollo_da_*` prefix is the logical Pollo DA database namespace. The dashboard's analytical facts are D1-only; Base is not an analytical fallback.

The top three GMV cards read `pay_type_daily`. The trend chart reads `chain_daily` for active payment and `renewal_daily` for renewal; the chain attribution tab uses the same respective fact tables.

Set `VITE_DATA_MODE=demo` only for a local visual preview. Production uses the same-origin Worker routes and does not require `API_ORIGIN`.

## 定时任务

`pollocloud.json` 已声明两个定时任务，时间使用北京时间：

- 每天 09:30–09:45（每 5 分钟一个任务，分别调用 `/api/cron/daily-pay-type`、`/api/cron/daily-chain`、`/api/cron/daily-creative`、`/api/cron/daily-renewal`）：按数据类型分批拉取最新 T+1 日数据并写入 D1；目标日期已存在时幂等跳过。拆分任务是为了避免一次同步超过平台单次请求的 4 分钟上限。
- 每周六 12:00（`0 12 * * 6` → `/api/cron/weekly-reports`）：选择上一完整周六至周五业务周，依次生成 Web 和 App 诊断报告。

两个接口都会校验 `x-pollocloud-trigger: cron`，不会接受普通用户请求。发布后可用 `pollocloud cron list --name pollo-ai` 查看配置，并用 `pollocloud cron run --name pollo-ai <任务>` 做一次验证。

## Report generation

The business-week selector controls both report viewing and generation. A request contains the selected Saturday–Friday analysis week and the immediately preceding baseline week. The Worker rejects future windows and missing baseline daily facts before invoking the model; an in-progress analysis week can use the observed days and calculates daily averages from that actual coverage. Historical selections never fall back to a different report.

Jobs and individual step states are stored in D1 (`report_jobs`). The application polls status every three seconds on the report page. A streamed execution request stays open in the shared layout while the Worker reads D1 facts, calculates attribution, calls Kimi, and writes the report to D1 history and latest-report tables. Navigation inside the dashboard keeps that request alive. Closing the browser can interrupt execution; jobs with no heartbeat for three minutes become failed and can be generated again. This is not a durable queue that guarantees execution after every client disconnect.

The task monitor is a compact floating control shared across dashboard routes, collapsed by default. Expanding it reveals real step states; navigation collapses it. Completed or failed notifications can be dismissed, are cleared on navigation, and are not restored on a fresh visit. Backend job records remain available for diagnosis. Each new run starts with new step state. Generated reports are written to both Base (`report_history` / `latest_report`) and D1; report reads prefer Base and fall back to D1 if Base is unavailable. Product actions are maintained and read from Base, with D1 as an availability fallback. Task status is written to Base `report_generation_jobs` and D1.

The default model is `kimi-k3` at `https://api.moonshot.ai/v1`; optional `KIMI_MODEL` and `KIMI_BASE_URL` override those settings. Secrets are managed with `pollocloud secret set`, never committed. Progress percentages count completed steps; model inference uses an indeterminate bar instead of invented percentage estimates.

“管理成员” opens Pollo Cloud's native embedded share page (`https://pollocloud.com/apps/pollo-ai/share?embed=1`) directly inside the dashboard dialog. This avoids the native button's one-time SPA initialization and keeps report execution alive in the parent layout. The dialog fits the viewport and does not change member access without an explicit user action.
