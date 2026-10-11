# Pollo Cloud deployment

The dashboard builds as a Pollo Cloud SPA. Its Worker reads analytical data from Feishu Base and pulls new daily facts from MaxCompute back into Base:

```bash
npm ci
npm run build
pollocloud login
pollocloud db execute --name pollo-ai --file db/0002_dashboard_response_cache.sql
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
```

The Feishu app must have record read/write API scopes and document-level access to Base `OjCAbXDNbavIU9seAzVcqUHanHg`. Record reads, creates, updates, and deletes have all been verified against this Base.

Dashboard endpoints push platform and date filters into Base, merge identical in-flight reads, and cache successful responses in the app's D1 database for ten minutes. An expired response can be served for up to one hour while Base refreshes in the background. `POST /api/sync-runs` queries MaxCompute for the selected daily range, replaces matching `web` and `app` records in the four daily fact tables, and clears the response cache when the run finishes.

The top three GMV cards read `pay_type_daily`. The trend chart reads `chain_daily` for active payment and `renewal_daily` for renewal; the chain attribution tab uses the same respective fact tables.

Set `VITE_DATA_MODE=demo` only for a local visual preview. Production uses the same-origin Worker routes and does not require `API_ORIGIN`.
