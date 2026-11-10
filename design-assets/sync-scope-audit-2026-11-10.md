# 同步范围与重复数据审计 · 2026-11-10

## 结论

旧 UI 的 `all + web + app` 表示同步范围，不表示需要把三份金额相加。支付事实目前只保存一份 canonical 数据，不能据此文案判断发生三倍重复。已移除这一易误读文案；确认弹窗改为「更新范围：全部端数据」。

## 线上只读证据

- `pollo_da_fact_rows` 的 pay_type 共 2,333,815 行，物理 platform 仅 all。
- `pollo_da_payment_single_scope_insert` 和 `pollo_da_payment_single_scope_update` 两个触发器禁止 pay_type 写入 web/app 镜像（迁移 db/0023_payment_single_scope_guard.sql）。
- `pollo_da_fact_rows_read` 从 device_type 投影 Web/App；查询必须先限定 platform。该读取视图的 all、web、app 不能跨 scope 直接相加。
- 2026-11-08，NONE 口径、排除汇总行、ACTIVE_PAYMENT/AUTO_RENEWAL/API：全端 $128,597.12，Web $89,778.82，App $38,818.30。当天金额相等；全端若有未知 device，则不保证恒等于已识别两端之和。

## 发现并修正的冗余查询

支付链路 all 查询已经返回 Web/App 维度行。原任务同时安排 all、web、app 的 chain 查询，会重复查询并覆盖相同主键；有主键及范围替换约束，因此不是追加三倍金额，但浪费上游查询。

已改为：请求范围包含 all 时，只安排一次 all:chain；只选择分端时，保留对应分端任务。pay_type 继续只同步一次。覆盖「all 顺序不同」「仅 Web/App」「仅 App」的回归检查通过。

## 不能机械合并的历史数据

创作 UV 与续订等旧数据仍保留 scoped 快照，读取会先过滤 platform。UV 是非可加指标，全端去重人数不能通过 Web UV + App UV 推算。此次不重写这些历史口径。

现代支付链路、创作、广告应用表按各自 ADS 维度主键落库、限定范围替换，不是将总计和分端当作三个独立增量追加。支付 NONE 与各归因模式也是不同读取口径，不能把模式之间的金额合计。

本次金额与主键审计均为只读；同步查询去重随本次交互与调度更新发布。新增调度表不修改业务事实数据。
