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

## 定时任务（2026-11-11 修订）

时区统一为 `Asia/Shanghai`，cron 直接写北京时间，不减 8 小时。

| 机制 | 时间 / 触发条件 | 执行内容 |
| --- | --- | --- |
| 每日数据批次 | 每天 **09:20**，`20 9 * * *` | `/api/cron/daily-data` 新建当天唯一批次，统计目标为昨日；成功后不会再新建同日批次 |
| 批次续跑 | 每 5 分钟，`*/5 * * * *` | `/api/cron/reports` 只恢复已经启动、尚未完成的批次；不会在夜间启动新的数据同步 |
| 产品动作 | 09:20 批次第一步 | 全量读取 Base 并发布校验后的 D1 快照；同日成功幂等跳过 |
| 事实同步 | 产品动作之后，依次执行 | 付费类型、支付链路、到期续订、创作活跃；分阶段保存游标，按批次日期冻结昨日目标，单次有执行时间预算 |
| 投放回收重算 | 同一批次、事实同步之后 | 昨日起近 7 天，以及昨日减 14/30/60/90/180 天的注册 cohort，刷新迟到数据与成熟回收窗口 |
| 创作留存重算 | 同一批次、投放之后 | 昨日起近 4 天，以及昨日减 7/30 天的 cohort，更新 D3/D7/D30 成熟窗口 |
| 日异动检测 / 诊断 | 数据批次完成且最后一次输入发布后至少 **5 分钟** | 下个五分钟回调执行；缓冲期间又有刷新则重新计时。无变更不重复付费生成；除周五统计日外，有异动生成大盘 + 对应异动端；周五由完整周诊断覆盖，不自动生成日报 |
| 周诊断 | **周六 12:00 Web、12:10 App** | 只在这两个时间点入队，执行时让位于日异动任务；同端、同区间成功报告直接复用 |
| 手动操作 | 管理员显式触发 | 页面可回刷指定统计日、暂停/恢复同步、手动诊断；手动诊断可绕过自动 5 分钟缓冲，但仍受模型互斥锁保护 |

09:20 是启动时间，不是承诺完成时间；MaxCompute 查询、D1 发布与多个数据集存在实际耗时。执行中的批次通过五分钟回调继续，完成后停止取数。历史重算是上述有限 cohort 集合，每天各一次，不是全天每五分钟补刷历史。

数据批次 `daily_refresh_batches` 保存任务列表、游标、失败原因和 15 分钟执行租约。并发回调只能有一个持有租约；次日批次独立登记，未完成的旧批次优先推进。异常停止在失败步骤、保留已发布旧数据，不无限重试，不执行后续诊断；管理员处理原因后用 `pollocloud cron run --name pollo-ai /api/cron/daily-data` 从失败游标显式重试当天批次。页面手动单日同步与每日批次为不同入口。

日诊断每次自动模型调用预算 210 秒，手动预算 540 秒；可恢复中断保留正文断点，至少等 1 分钟后、在下次五分钟调度恢复，最多两次无进展重试或六次有进展续写。共享模型执行锁为 15 分钟；周任务等待其他日期的日异动队列清空；周五统计日的未启动自动日报（含断点重试）会退出队列，保留异动检测、成功历史与管理员显式日诊断。周报告同端同区间已成功则不重复，失败需显式重试。完整业务周为周六至周五，因此周六刷新到周五后只做异动检测，不提前生成自动日报或提前触发周报；周报在周六中午 12:00 Web、12:10 App 入队。周报失败不悄悄改跑日报，由管理员查看原因并重试；显式手动日诊断不受此去重规则限制。

浏览器只轮询任务进度与读取已落库结果：同步执行中每 2 秒、日诊断任务每 15 秒、周报告页每 3 秒读取状态。这些是状态请求，不会按此频率查询 MaxCompute；顶部刷新读取数据库/缓存，与管理员同步数据源是不同操作。看板响应缓存有效 10 分钟，过期后最多复用 1 小时旧响应并后台从 D1 刷新；数据发布会主动清理响应缓存。

线上核对：`pollocloud cron list --name pollo-ai --json` 应只显示 `daily-data` 每天 09:20 和 `reports` 每五分钟两项。定时接口校验平台 `x-pollocloud-trigger: cron`，不接受普通用户伪造请求。

### 数据口径与历史手动补刷

广告归因聚合保存在 `pollo_da_ads_daily`，粒度为注册日、广告渠道、国家和 Web/App 端，业务周为周六至周五。广告表同步只读取 `product_type='ALL'` 与 `is_first_purchase='汇总'`，避免叠加拆分行。历史全量回刷在本地运行 `python3 scripts/backfill-ads.py --start 2026-01-01 --end 2026-11-03`，脚本通过 Tunnel 完整读取、校验后暂存并切换远程 D1。`POST /api/ads/sync` 可由已授权账号指定 `date` 补刷单日。

创作链路使用 `pollo_da_creation_overall_daily`（日×源端，源表 `creation_mode='汇总'`，跨功能去重 UV）和 `pollo_da_creation_function_daily`（日×源端×功能×新老用户×近 30 天付费分层，仅保留两个分层维度的明细行）。两个表均不使用发起、提交埋点或预存比率。功能 UV、每日 UV、各端 UV 不能跨相应粒度相加；`platform_type='汇总'` 是源表跨端去重行。业务周为周六至周五，周去重 UV 无法从日聚合推导；`user_type=NEW` 指当日注册，不是本业务周注册。`未归因` 功能仅作 GMV 对账。源表历史覆盖自 2026-09-27 起；本地运行 `python3 scripts/backfill-creation-chain.py extract`、`estimate`、`backfill` 导出聚合行、校验并回刷。`POST /api/creation-chain/sync` 可指定 `date` 补刷单日。未成熟的 D3/D7/D30 留存人数保持 NULL。

`gmv_d14` 至 `gmv_d180` 对未成熟 cohort 也可能返回截至当前的部分累计值，不会自动置空。业务周比较这些指标时，仅使用整个业务周均已达到相应观察天数的 cohort；花费、曝光、点击、注册和 D0 可按已覆盖日期聚合。

## Report generation

The business-week selector controls both report viewing and generation. A request contains the selected Saturday–Friday analysis week and the immediately preceding baseline week. The Worker rejects future windows and missing baseline daily facts before invoking the model; an in-progress analysis week can use the observed days and calculates daily averages from that actual coverage. Historical selections never fall back to a different report.

周报告的任务与步骤保存在 D1 `report_jobs`，报告页每 3 秒读取状态。手动启动使用流式执行请求，后台五分钟回调也会接管排队的周任务；日诊断则由独立的持久化任务与断点机制执行。页面导航保留共享布局中的请求；周任务运行中超过 3 分钟无心跳会标记失败，需要显式重试，不能把它与支持断点恢复的日诊断混为一谈。

The task monitor is a compact floating control shared across dashboard routes, collapsed by default. Expanding it reveals real step states; navigation collapses it. Completed or failed notifications can be dismissed, are cleared on navigation, and are not restored on a fresh visit. Backend job records remain available for diagnosis. Each new run starts with new step state. 周报告同时写入 Base (`report_history` / `latest_report`) 和 D1；最新报告优先读取 D1，历史列表和历史详情优先 Base、不可用时回退 D1。日诊断与每日动态读取 D1。产品动作从 Base 同步、校验后发布 D1 快照，交互页面读取该快照。周任务状态写入 Base `report_generation_jobs` 和 D1。

The default model is `kimi-k3` at `https://api.moonshot.ai/v1`; optional `KIMI_MODEL` and `KIMI_BASE_URL` override those settings. Secrets are managed with `pollocloud secret set`, never committed. Progress percentages count completed steps; model inference uses an indeterminate bar instead of invented percentage estimates.

“管理成员” opens Pollo Cloud's native embedded share page (`https://pollocloud.com/apps/pollo-ai/share?embed=1`) directly inside the dashboard dialog. This avoids the native button's one-time SPA initialization and keeps report execution alive in the parent layout. The dialog fits the viewport and does not change member access without an explicit user action.


## 支付事实单份存储（2026-11-09）

`pollo_da_fact_rows` 的 `pay_type` 仅持久化 `platform=all`，通过 `device_type` 保留 Web、iOS、Android 和未知端。`pollo_da_fact_rows_read` 提供原有全端 / Web / App 查询语义，不存储副本；未知支付端仅计入全端。其他数据集的全端 UV 不可由分端相加，维持原有存储。

部署顺序：先应用 `db/0022_single_payment_facts.sql`，发布单份查询与写入代码，再运行 `python3 scripts/compact-payment-scopes.py --apply`。脚本校验无运行中同步、逐月核对逻辑行数及 GMV / 成本 / 订单当量、安装 `0023` 写入保护，之后删除支付表中的 Web/App 副本。默认不加 `--apply` 只校验。仅删除可由保留的按设备事实完整重建的副本。

付费同步只生成一次 `all-pay_type` 步骤；即便手动选择 Web 或 App，支付数据也统一按全部支付设备刷新该日期范围，并与注册明细一并事务发布。其他数据集仍按选择范围同步。手动支付回刷使用 `backfill-pay-type-products.py`；较早 `backfill-middle-tables.py` 的镜像写入方式已废弃，数据库保护会拒绝旧格式，不能绕过保护运行。注册对账与看板查询应读取只读视图；物理存储量检查读取事实表。

注册端、国家层级、注册新老、SKU、升级组合、积分档位和周期组合保持不变。新增事实字段时，须同步更新 `0022` 视图的显式列清单。不要创建远程整表副本来执行这次压缩。

本次清理和空间回收结果见 `D1_STORAGE_OPTIMIZATION.md`。`VACUUM` 经当前平台执行入口会因事务限制失败；本次已通过副本删除和逐个索引重建回收空间，未声称完成整库紧凑化。
