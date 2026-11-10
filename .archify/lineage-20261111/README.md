# Pollo 交互式血缘

四份 JSON 是可复用的 Archify 3.2 源码。输出位于 `client/public/lineage/`，入口为 `client/public/data-lineage.html`。

`review-2-*` 是当前交付的自动验证与浏览器检查记录（投放与动作以 `review-3-operations` 为准）；`review-1` 是最初排版的历史记录。当前 HTML 与相邻 `.delivery.json` 为完整溯源配对，不手工修改生成 HTML。

范围：已核对 SQL 的上游表 → 同步聚合后的 D1 表 → 看板 API。未展示上游 ADS 内部无法由本仓库验证的加工链。产品动作使用当前快照读取路径，不把旧 `pollo_da_product_actions` 当成当前数据源。
