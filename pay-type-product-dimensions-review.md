# 付费类型 SQL 审阅

审阅模板基于原付费类型 SELECT，增加 `product_type, product_type_lv2`，并移除常量 `'ads_v1' AS metric_version`。原有 WHERE 条件不变，审阅稿没有新增 CTE 或 GROUP BY，见 [pay-type-product-dimensions-review.sql](pay-type-product-dimensions-review.sql)。当前线上后续版本的生成器另有 `sku_rows` 汇总层，但保留上述字段和筛选口径；2026-11-06 实际执行返回 11,652 行，与原始取数粒度一致。

相关数据表：上游 MaxCompute 表 `mc_prd.ads_pollo_transaction_gmv_attribution_daily_dip`；应用正式 D1 表 `pollo_da_fact_rows`，其中 `dataset='pay_type'`；应用同步暂存 D1 表 `pollo_da_payment_fact_stage`。`pay_type_daily` 是 Worker 使用的逻辑数据集名，不是独立的 D1 物理表。历史回刷脚本另外使用过一次性暂存表，不能把它当常规读数来源。

正式表和同步暂存表均已增加两列；产品维度已进入 `source_record_id`，避免不同产品行互相覆盖。付费类型行的 `metric_version` 现为 NULL；该物理列留在共用事实表中供其他数据集使用。

本次直接取数 SQL 曾发布为 `0mw5axx4li4cmoofkp0`；检查时线上最新版本为 `0mw5gvsi7j0fwtzpesv`，其付费取数与写入仍包含两列且不写入旧版本值。从 2026-01-01 回刷至当时源表最新分区 2026-11-06，共 310 天、4,611,925 条 all/web/app 记录。每月校验行数、日期覆盖、四种归因模式的 GMV 和订单当量；回刷后付费类型行的产品字段空值数、旧版本值数均为 0，一次性暂存表已清理。
