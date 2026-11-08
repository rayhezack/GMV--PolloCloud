# Pollo 归因看板：图表数据血缘与口径

以下是当前代码的读取链路；MaxCompute 上游表由同步 SQL 读取，D1 表由 Worker API 聚合。`all`、`web`、`app` 是端口筛选，不能把 `all` 与子端口再次相加。业务周为周六至周五，周日均使用实际可比日期数。

血缘图源文件：`client/public/data-lineage.html`；页面「数据与口径 → 图表血缘」展示 High-Level 数据管道总览，以及支付、创作与投放两张 Dependency Graph。依赖图箭头指向被依赖的处理逻辑或事实表，角标为直接引用次数；总览箭头表示数据流向。各图采用 1280×720 原生宽度，窄容器内横向滚动，避免缩小后表名不可读。

| 页面 / 图表 | MaxCompute 上游 | D1 落表与读取接口 | 口径边界 |
| --- | --- | --- | --- |
| GMV 趋势三指标卡、迷你趋势、收入趋势支付结果线 | `ads_pollo_transaction_gmv_attribution_daily_dip` | `pollo_da_fact_rows`（`pay_type`，`NONE`、非汇总支付结果）→ `/api/dashboard/overview` 的 `payTypeTrend` | 大盘含主动付费、自动续订、API；主动付费只取 `ACTIVE_PAYMENT`，API 单列。卡片展示所选范围内最新日期单日值，WoW 对比 7 天前同日；折线保留所选范围全部可用日期。不得用漏斗 GMV 替代。 |
| GMV 趋势漏斗指标、支付链路趋势和驱动 | `ads_pollo_transaction_paywall_user_daily_dip` | `pollo_da_chain_funnel`、`pollo_da_chain_breakdown` → `/api/dashboard/overview`、`/api/dashboard/attributions?dimension=chain`、`/api/dashboard/chain-funnel` | 用户-日链路归因；未串联支付不被分配到过程指标。 |
| 付费类型贡献、套餐与功能/模型下钻 | `ads_pollo_transaction_gmv_attribution_daily_dip` | `pollo_da_fact_rows`（`pay_type`）→ `/api/dashboard/attributions?dimension=pay_type`、`/api/dashboard/payment-trend` | 结果为 `NONE`；下钻仅取所选的 `CREATION_MODE`、`MODEL` 或 `ACTUAL_MODEL`。不同归因模式不能相加；成本汇总行不计入 GMV。 |
| 付费下钻注册国家 / 注册新老 | `dwd_pollo_transaction_order_dip` 联合 `dim_pollo_user_account_dfp` 最新快照 | `pollo_da_payment_registration` → 付费下钻读取及核对 | 国别取订单 `reg_country`；新老按注册日期和当前业务周判定，无法匹配为“未知”。独立订单口径需与结果总额对账，失败时不展示拆分。归因 SQL 本身没有这些字段。 |
| 自动续订到期 cohort 及驱动 | `ads_pollo_renewal_cohort_dip` | `pollo_da_fact_rows`（`renewal`）→ `/api/dashboard/attributions?dimension=chain&chainType=renewal` | 到期日期归组；与支付日发生的续费金额不是同一时间分组。 |
| 创作指标卡、创作趋势、功能表现（日 / 周） | `ads_pollo_creation_function_chain_daily_dip` | `pollo_da_creation_overall_daily`、`pollo_da_creation_function_daily` → `/api/dashboard/creative-overview` | 源表 `creation_mode=user_type=pay_gmv_usd_30d='汇总'` 为整体，非汇总为功能明细；功能用户跨功能不可简单求和。此 Tab 不展示源表 `gmv_usd`。 |
| 创作分层、创作渗透率与人均创作任务 | `ods_pollo_log_event_dip`、`dwd_video_pollo_video_generate_record_dfp` | `pollo_da_fact_rows`（`creative`）→ `/api/dashboard/attributions?dimension=creative`；整体活跃 UV 也接入 `creative-overview` | 活跃人群与近 30 日创作次数分层；渗透率的分子、分母必须同一活跃人群。 |
| 投放指标卡、国家周对比、渠道分析 | `ads_pollo_ad_attribution_daily_dip` | `pollo_da_ads_daily` → `/api/dashboard/ads-overview` | 展示点击、成本、展示、注册与回收；国家表按所选指标分析周的绝对日均值降序，不按变化量排序。 |
| 投放注册 Cohort LTV / ROAS / CAC | `ads_pollo_ad_attribution_daily_dip` | `pollo_da_ads_daily` → `/api/dashboard/ads-overview` 的 `cohortMatrix` | 以获客注册日归组，`LTV=该 cohort 累计 GMV/注册 UV`，`CAC=该 cohort 广告成本/注册 UV`；未成熟或缺失的回收窗口为空，不补零。 |
| GMV 异动提醒与产品动作标注 | 支付结果、链路源表；飞书 Base 产品动作 | `pollo_da_fact_rows`、`pollo_da_chain_funnel` → 异动接口；`pollo_da_product_actions`、`pollo_da_product_action_details` → `/api/dashboard/product-actions` | 异动阈值基于完整历史业务周；上升、下降均匹配同日同端动作，保留全部达标日期，密集图标错行显示。动作只作为日期注释，不计入 GMV，也不代表因果归因。 |

## 创作 GMV 差异的核查

之前创作功能表把创作链路源表的 `gmv_usd` 标成“归因GMV”，而大盘 GMV 来自支付结果 `NONE` 行。二者聚合维度和端口归属并非同一接口，不能因为名字相同就作为相同指标比较。本地 D1 的 **2026-11-04** 数据：创作链路 `platform_type='汇总'` 为 **$143,716.65**，支付结果 `platform='all'` 同为 **$143,716.65**；但创作 `WEB` 为 **$115,240.65**，支付结果 `web` 为 **$106,753.20**，相差 **$8,487.45**。这证明不能用全端某日相等来保证各端、各周的对账，更不能据此推断截图中 11 月 7 日的差额成因。创作 Tab 因此移除此字段，保留任务、用户、成功、采纳、留存等创作指标。需要精确解释特定日期差异时，应同时取源表分端行和支付结果行按日期核对。

关键实现：`server/modules/maxcompute/{middle-table-sql,chain-funnel-sql,creation-chain-sql,ads-sql,payment-registration-sql,sql-templates}.ts`、`worker/index.ts`、`client/src/pages/DashboardPage/DashboardPage.tsx`。
