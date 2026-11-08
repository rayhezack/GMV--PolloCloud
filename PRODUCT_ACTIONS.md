# 产品动作明细入仓

- 来源：飞书 Base `OjCAbXDNbavIU9seAzVcqUHanHg` → 产品动作明细 `tblNJGIo2su7HMF8`。
- D1 明细表：`pollo_da_product_action_details`，状态表：`product_action_sync_state`。先执行 `db/0019_product_action_details.sql`。
- 保存更新点、板块、上线时间、说明、原消息链接、类型、来源、版本、端；排除统计日/统计时间。`fields_json` 保留原始结构及其他新增字段；其余字段为检索列，另有来源 record ID、快照 ID 和入仓时间。
- 未填写上线日期的记录仍入仓，但不推定日期、不生成图表标注。

## 同步与发布

复用 `/api/cron/daily-renewal` 的现有每五分钟触发器，按北京时间每天成功同步一次。手动运行此任务会强制刷新产品动作。动作同步先独立执行，不依赖 MaxCompute 成功；失败后下一轮重试。

读取全部分页并核对 total、has_more、分页 token 和 record ID 后，分批写入新快照。记录数校验通过才原子切换 active_snapshot。旧记录的修改和删除会随新快照生效；超时、截断或写入失败均保留上一次完整快照。并发任务通过 D1 租约互斥。

看板 `/api/dashboard/product-actions` 和产品动作数据预览/报告读取 D1，浏览器请求不再等待 Base。API 的 readAt 是成功入仓时间；同步错误保存在状态表并在口径浮层提示。

## 验证

`node --test worker/product-actions-store.test.mjs worker/product-actions-api.test.mjs` 验证分页完整性、失败保留旧快照、更新/删除、每日幂等、并发和接口不访问 Base。
