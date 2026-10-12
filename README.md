# Pollo AI GMV Dashboard

Pollo Cloud edition of the GMV trend and attribution dashboard. The SPA is built with Vite; its Worker reads daily facts from Feishu Base and syncs new facts from MaxCompute.

## Data sources

- Top GMV cards: `pay_type_daily` for total, active payment, and automatic renewal GMV.
- Trend and attribution: `chain_daily` for active payment, `renewal_daily` for automatic renewal, and `creative_daily` for creation activity.
- Successful dashboard responses are cached briefly in the app's D1 database. Base remains the source of truth.

## Development and deployment

```bash
npm ci
npm run dev
npm run type:check
npm run build
pollocloud db execute --name pollo-ai --file db/0002_dashboard_response_cache.sql
pollocloud db execute --name pollo-ai --file db/0004_sync_jobs.sql
pollocloud db execute --name pollo-ai --file db/0005_sync_queued.sql
pollocloud db execute --name pollo-ai --file db/0006_sync_staging.sql
pollocloud db execute --name pollo-ai --file db/0007_paused_job_indexes.sql
pollocloud db execute --name pollo-ai --file db/0008_sync_staging_chunks.sql
pollocloud deploy
```

See [POLLOCLOUD.md](POLLOCLOUD.md) for required server-side secrets and access settings. The design rules are in [DESIGN.md](DESIGN.md).
