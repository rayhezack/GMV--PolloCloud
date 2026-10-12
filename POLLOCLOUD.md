# Pollo Cloud deployment

The dashboard builds as a Pollo Cloud SPA. Its Worker reads analytical data from Feishu Base and pulls new daily facts from MaxCompute back into Base:

```bash
npm ci
npm run build
pollocloud login
pollocloud db execute --name pollo-ai --file db/0002_dashboard_response_cache.sql
pollocloud db execute --name pollo-ai --file db/0003_report_jobs.sql
pollocloud db execute --name pollo-ai --file db/0006_sync_staging.sql
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

Dashboard endpoints push platform and date filters into Base, merge identical in-flight reads, and cache successful responses in the app's D1 database for ten minutes. An expired response can be served for up to one hour while Base refreshes in the background. `POST /api/sync-runs` stages each MaxCompute query result in D1. Only after every query succeeds does the Worker replace the matching `web` and `app` records in the four Base fact tables and clear the response cache.

The top three GMV cards read `pay_type_daily`. The trend chart reads `chain_daily` for active payment and `renewal_daily` for renewal; the chain attribution tab uses the same respective fact tables.

Set `VITE_DATA_MODE=demo` only for a local visual preview. Production uses the same-origin Worker routes and does not require `API_ORIGIN`.

## Report generation

The business-week selector controls both report viewing and generation. A request contains the selected Saturday–Friday analysis week and the immediately preceding baseline week. The Worker rejects incomplete/future windows and missing daily facts before invoking the model. Historical selections never fall back to a different report.

Jobs and individual step states are stored in D1 (`report_jobs`). The application polls status every three seconds on the report page. A streamed execution request stays open in the shared layout while the Worker reads Base, calculates attribution, calls Kimi, and writes the report to Base history and latest-report tables. Navigation inside the dashboard keeps that request alive. Closing the browser can interrupt execution; jobs with no heartbeat for three minutes become failed and can be generated again. This is not a durable queue that guarantees execution after every client disconnect.

The task monitor is a compact floating control shared across dashboard routes, collapsed by default. Expanding it reveals real step states; navigation collapses it. Completed or failed notifications can be dismissed, are cleared on navigation, and are not restored on a fresh visit. Backend job records remain available for diagnosis. Each new run starts with new step state. Report drafts are checkpointed in D1 before Base writes, and transient write failures are retried. Base's `degraded` single-select field is written as the string `true` or `false`.

The default model is `kimi-k3` at `https://api.moonshot.ai/v1`; optional `KIMI_MODEL` and `KIMI_BASE_URL` override those settings. Secrets are managed with `pollocloud secret set`, never committed. Progress percentages count completed steps; model inference uses an indeterminate bar instead of invented percentage estimates.

“管理成员” opens Pollo Cloud's native embedded share page (`https://pollocloud.com/apps/pollo-ai/share?embed=1`) directly inside the dashboard dialog. This avoids the native button's one-time SPA initialization and keeps report execution alive in the parent layout. The dialog fits the viewport and does not change member access without an explicit user action.
