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
pollocloud db execute --name pollo-ai --file db/0013_creation_chain.sql
pollocloud db execute --name pollo-ai --file db/0015_payment_registration.sql
pollocloud db execute --name pollo-ai --file db/0016_chain_sync_stage.sql
pollocloud db execute --name pollo-ai --file db/0017_payment_sync_stage.sql
# Inspect existing columns before applying ALTERs in 0014 / 0018; see release check below.
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

The GMV cards and active-payment trend use canonical payment-result facts (`dataset='pay_type'`, with attribution modes kept separate). Funnel diagnostics use `pollo_da_chain_funnel` / `pollo_da_chain_breakdown`. Renewal process metrics still use the legacy `dataset='renewal'` facts because no replacement source exists; preserve those rows during any payment-result migration.

### 2026-11-07 远程发布前数据检查

本次仅执行数据库准备，未提交 Git、推送或部署代码。证据及导入脚本在 `.impeccable/review/2026-11-07-release/remote-data/`。

| 迁移 | 远程状态 |
| --- | --- |
| 0014 | 已为整体、功能创作的 daily / stage 四张表添加 `valid_creation_task_cnt`；重复执行 ALTER 会报错，先查 `PRAGMA table_info`。 |
| 0015 | registration 正式表及索引已存在，17,829 行已通过父子对账并激活。 |
| 0016 | 已创建 chain funnel / breakdown 两张同步 stage。 |
| 0017 | payment fact / registration 两张同步 stage 已存在，列顺序与各自主表一致。 |
| 0018 | fact / payment fact stage 均已有 `product_type`、`product_type_lv2`，本轮没有重复 ALTER。有列不等于历史数据已完成 SKU 回填。 |

创作请求数已从源表只读聚合导出并按键补齐：2026-09-27 至 2026-11-05 的整体 161 行、功能 47,509 行全部有值，两表请求数合计均为 18,981,296。补值前逐行验证原 `creation_task_cnt` 与源表相同；仅填充新增列的 NULL，保留远程较新的采纳、留存、GMV 等其他字段。两表 GMV 仍各为 9,683,201.48438977。源表额外组合未扩写到正式功能表。

**本次发布阻塞已消除：registration 已激活。** 2026-10-06 至 2026-11-04 的 17,829 行已写入正式表，主键无 NULL、无重复，GMV 为 4,003,401.1535354424。全部 597 个日期×设备×支付类型父子分组已对账，差异为零（金额校验阈值 1e-6）。

远程原有 74 组“首订／重新订阅”分类与本次 ADS/SKU 新快照不一致。此次仅替换对应 37 个日期／设备分区中的这两种支付类型，复用现有 SKU backfill 的身份键与字段契约，保留 NONE、CREATION_MODE、MODEL、ACTUAL_MODEL 四种模式，共写入 73,648 行。切换前验证 296 个日期×端×归因模式组的两类收入合计守恒；先完整备份旧行到 `pollo_da_payment_groups_backup_20261107`，再逐分区切换，其他日期、支付类型与旧续订不变。没有按比例调整注册明细，也没有修改支付分类 SQL。注册正式表激活后已清理 D1 响应缓存。

切换后的全范围核验：4,776 个日期×端×设备×支付类型×归因模式分组与 ADS/SKU 新快照全部一致，最大浮点误差约 3.28e-11；73,648 行支付与 17,829 行注册数据均通过暂存／正式表逐行关键字段核验，零缺失、零差异。旧支付受影响行备份共 28,258 行。2026-11-04 Web 原始精度验证：总 GMV 106,753.2009660036 = 主动 73,707.7024284233 + 自动续订 26,565.4985375803 + API 6,480，注册明细汇总同为 106,753.2009660036。最终机器结果见 `remote-data/summary.json`，`readyForDeployment=true` 仅表示本次有界数据与 schema 门禁通过，不代表全年 SKU 历史回填完成。

以下命令可复核并幂等重导 registration。激活命令仅在全部父子分组误差不超过 1e-6 时写入正式表；不一致时退出码为 2，正式表不变。不要在已修复后再次执行 `repair-payment-groups`：它使用首次差异清单作有界切换；全年 SKU 历史回填仍应由独立 backfill 负责，本次未扩范围。

```bash
python3 .impeccable/review/2026-11-07-release/remote-data/import-stages.py activate-registration
pollocloud db execute --name pollo-ai --file .impeccable/review/2026-11-07-release/remote-data/verify.sql --json
```

旧自动续订在本轮前后均为 4,114 行、到期用户合计 584,704、续订用户合计 322,782、金额 7,624,728.233426。注册表按非空复合主键幂等导入；链路表的复合键包含 NULL，SQLite 不会阻止 NULL 键重复，后续链路替换应使用验证过的有界分区暂存切换，不应简单 `INSERT OR REPLACE` 叠加。本次未替换或删除历史链路、续订事实，也未扩大全年支付回填范围。

CLI 每次请求最多 1 MB，但单条 SQL 另有长度限制。此次实际使用每条 INSERT 不超过约 60 KB、每次请求约 480 KB；不要把 1 MB 当成单条 INSERT 的可用长度。

Set `VITE_DATA_MODE=demo` only for a local visual preview. Production uses the same-origin Worker routes and does not require `API_ORIGIN`.

### 本地演示数据

在 Node.js 22.13+ 下运行 `npm run data:local`，将各数据源共同覆盖的最新日期及之前 29 天从 D1 分页读取并保存为只读 SQLite 快照，核对付费类型的行数及 GMV 后启用。快照保存在被 Git 忽略的 `.local-data/`，包含支付分层、链路诊断、广告、创作及期间报告。

准备完成后运行 `npm run dev`（已有服务需重启），各 Tab 直接读取本地快照，统一使用最近 30 天。按钮刷新只重新读取本地数据；需要更新快照时重新运行 `npm run data:local`。网络中断后可用 `npm run data:local -- --resume` 复用已完成的分页。`POLLO_REMOTE_DATA=1 npm run dev` 可恢复原有远端开发代理。生产构建不包含本地快照。

## 定时任务

线上实际时区为 `Asia/Shanghai`（北京时间）。2026-11-09 核对 `pollocloud cron list --name pollo-ai --json` 与 `pollocloud.json` 一致，当前为全天轮询，**不是每天仅 09:00 执行一次**：

| 任务 | 实际触发时间 | 每日触发次数 |
| --- | --- | --- |
| 付费类型 | 每小时 00、05、10…55 分 | 288 |
| 支付链路 | 每小时 01、06、11…56 分 | 288 |
| 自动续订 | 每小时 02、07、12…57 分 | 288 |
| 创作积极性 | 每小时 03、08、13…58 分 | 288 |
| 产品动作快照 | 每天 09:10 开始；失败后每 5 分钟重试至当日 23:55，成功后跳过 | 最多 178 次有效检查 |
| 周报告 | 周六每小时 00 分 Web、10 分 App | 仅周六，48 次 |

产品动作改用独立 `/api/cron/daily-product-actions` 回调：北京时间每天 09:10 全量读取 Base、校验并发布 D1；09:00 / 09:05 的回调在读取源表前跳过，09:10 起失败后每 5 分钟重试至 23:55，成功后当天跳过。09:10 之后新增或补录的动作在次日快照同步；页面回刷不触发动作同步。旧版本当天 00:02 的快照不阻止新版本在 09:10 更新。产品动作不占用事实数据同步执行槽。以上是回调时间，不保证该分钟开始或完成一个完整数据任务；任务共享执行槽，每次回调可能只推进一个阶段，也可能因为目标数据已存在或其他任务占用而跳过。周报告已有成功结果时幂等跳过。

旧文档中的 09:00 / 09:05 / 09:10 / 09:15 和周六 12:00 与线上不符，已更正。本次仅将产品动作调整为 09:10 独立同步，其他数据任务调度保持原配置。风险、记录与改进方案见 [SYNC_RELIABILITY_AUDIT.md](SYNC_RELIABILITY_AUDIT.md)。

广告归因聚合保存在 `pollo_da_ads_daily`，粒度为注册日、广告渠道、国家和 Web/App 端，业务周为周六至周五。广告表同步只读取 `product_type='ALL'` 与 `is_first_purchase='汇总'`，避免叠加拆分行。支付链路回调返回成功或跳过时，会轮转回刷广告最近 7 天及距今 14/30/60/90/180 天的 cohort 分区（每次选择一个分区）；该表会动态更新最近 181 天分区，但历史分区从 2026-01-01 起仍可读取。历史全量回刷在本地运行 `python3 scripts/backfill-ads.py --start 2026-01-01 --end 2026-11-03`，脚本通过 Tunnel 完整读取、校验后暂存并切换远程 D1。`POST /api/ads/sync` 可由已授权账号指定 `date` 补刷单日。

创作链路使用 `pollo_da_creation_overall_daily`（日×源端，源表 `creation_mode='汇总'`，跨功能去重 UV）和 `pollo_da_creation_function_daily`（日×源端×功能×新老用户×近 30 天付费分层，仅保留两个分层维度的明细行）。两个表均不使用发起、提交埋点或预存比率。功能 UV、每日 UV、各端 UV 不能跨相应粒度相加；`platform_type='汇总'` 是源表跨端去重行。业务周为周六至周五，周去重 UV 无法从日聚合推导；`user_type=NEW` 指当日注册，不是本业务周注册。`未归因` 功能仅作 GMV 对账。源表历史覆盖自 2026-09-27 起；本地运行 `python3 scripts/backfill-creation-chain.py extract`、`estimate`、`backfill` 导出聚合行、校验并回刷。现有创作回调返回成功或跳过时，轮转补刷昨日及之前 3 日、距昨日 7/30 天的留存分区（每次选择一个分区）；`POST /api/creation-chain/sync` 可指定 `date` 补刷单日。未成熟的 D3/D7/D30 留存人数保持 NULL。

`gmv_d14` 至 `gmv_d180` 对未成熟 cohort 也可能返回截至当前的部分累计值，不会自动置空。业务周比较这些指标时，仅使用整个业务周均已达到相应观察天数的 cohort；花费、曝光、点击、注册和 D0 可按已覆盖日期聚合。

定时接口都会校验 `x-pollocloud-trigger: cron`，不会接受普通用户请求。发布后可用 `pollocloud cron list --name pollo-ai` 查看配置，并用 `pollocloud cron run --name pollo-ai <任务>` 做一次验证。

## Report generation

The business-week selector controls both report viewing and generation. A request contains the selected Saturday–Friday analysis week and the immediately preceding baseline week. The Worker rejects future windows and missing baseline daily facts before invoking the model; an in-progress analysis week can use the observed days and calculates daily averages from that actual coverage. Historical selections never fall back to a different report.

Jobs and individual step states are stored in D1 (`report_jobs`). The application polls status every three seconds on the report page. A streamed execution request stays open in the shared layout while the Worker reads D1 facts, calculates attribution, calls Kimi, and writes the report to D1 history and latest-report tables. Navigation inside the dashboard keeps that request alive. Closing the browser can interrupt execution; jobs with no heartbeat for three minutes become failed and can be generated again. This is not a durable queue that guarantees execution after every client disconnect.

The task monitor is a compact floating control shared across dashboard routes, collapsed by default. Expanding it reveals real step states; navigation collapses it. Completed or failed notifications can be dismissed, are cleared on navigation, and are not restored on a fresh visit. Backend job records remain available for diagnosis. Each new run starts with new step state. Generated reports are written to both Base (`report_history` / `latest_report`) and D1; report reads prefer Base and fall back to D1 if Base is unavailable. Product actions are maintained and read from Base, with D1 as an availability fallback. Task status is written to Base `report_generation_jobs` and D1.

The default model is `kimi-k3` at `https://api.moonshot.ai/v1`; optional `KIMI_MODEL` and `KIMI_BASE_URL` override those settings. Secrets are managed with `pollocloud secret set`, never committed. Progress percentages count completed steps; model inference uses an indeterminate bar instead of invented percentage estimates.

“管理成员” opens Pollo Cloud's native embedded share page (`https://pollocloud.com/apps/pollo-ai/share?embed=1`) directly inside the dashboard dialog. This avoids the native button's one-time SPA initialization and keeps report execution alive in the parent layout. The dialog fits the viewport and does not change member access without an explicit user action.
