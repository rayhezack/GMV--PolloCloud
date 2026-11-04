# Pollo AI GMV 分析看板

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

面向进行产品分析和收入诊断的数据分析人员；用户需要对比业务周、端、付费类型以及不同收入归因方式。

## Product Purpose

从收入变化定位付费类别、创作功能、创作模型和实际调用模型的变化来源，并同时观察模型成本与成本 / GMV。

## Operating Context

本地 React / Vite 看板读取远程 Pollo Cloud D1；MaxCompute ADS 为支付链路、GMV 归因的事实来源。业务周为周六至周五，未完整周使用相同业务日对齐的日均比较。

## Capabilities and Constraints

- GMV 有 NONE、CREATION_MODE、MODEL、ACTUAL_MODEL 四种独立归因模式，不能相加。
- GMV ADS 暂覆盖 2026-10-01 起；1—9 月保留 legacy 历史，不伪造缺失的模型归因。
- 全部收入包含主动付费、自动续订和 API，可分别筛选。
- 模型成本覆盖全部创作用户，仅在模型归因的收入类别与收入子类双汇总行出现。成本不随付费类型筛选分摊，不等同付费用户成本。
- 用户已确认模型视图同时展示 GMV、模型成本和成本 / GMV；不能把这项比率解释为利润率。
- 此次改造覆盖本地付费类型、GMV 趋势和紧凑导航；不提交或部署。
- 付费趋势按日看近 30 天、周看近 12 业务周、月看近 12 月，均展示日均值；明细独立比较所选业务周。

## Brand Commitments

用户指定 Stripe 的设计语言和紫色主题，使用紧凑 Bento data viz cards 与 shadcn/ui；去掉环形图及低信息量的右侧指标卡。避免不必要的次级标签和说明，让布局表达关系。

## Evidence on Hand

用户提供的 Stripe 设计参考、Obsidian Data Viz 图表源码、已回刷的 ADS 事实数据，以及本地 SQL 与迁移验收档案。

## Product Principles

- 同一指标只从一个归因模式计算，汇总行与明细行分开聚合。
- 所有比较保持单位、范围和业务日数明确且一致。
- 缺失数据与真实零值严格区分。
- 优先用可比较的图表和密集表格表达信息。
