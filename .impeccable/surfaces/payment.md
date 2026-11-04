# 付费类型

Mode: Operate

Target: client/src/components/dashboard/PaymentAnalysis.tsx

用户指定世界：Stripe 产品界面；紫色 #533afd、白色图表表面、深海军蓝文字、冷色细分隔线。数据图形参考用户 Obsidian Data Viz 中的 Revenue by Product Line、Profit Margin Analysis 和 Finance Overview。

第一屏：页头已有日期与端筛选，下方一行四种归因模式及收入筛选；主图占 8 列，GMV 占比分布图占 4 列。图卡将金额、比较值和图形整合到同一表面，没有单独 KPI 卡片、环形图或独立右侧指标区。下方全宽归因表；模型模式增加成本列、成本占比和双指标图。

主要交互：切换归因模式改变归属；主表支持搜索、排序和点选，所选实体的走势与付费结构以侧抽屉查看；实际调用模型可切换模型 / 渠道商 / 厂商。

成本完整粒度为日 × 模型 × 端 × 实际渠道商 × 实际厂商；只从双汇总行读取，不加入付费子类明细。保留无归因收入、仅有成本模型及成本占比大于 100% 的结果。

成功标准：四模式 GMV 对 NONE 守恒；成本对原始汇总行守恒；无重复成本、无错误利润标签；桌面和移动端可用，键盘可切换筛选和表格条目。

## Direction contract

THESIS: 紧凑的收入诊断工作台，图形、数值和下钻共用信息层级；移除旧环形图与独立右侧 KPI 卡片。
OWN-WORLD: Stripe 产品界面，紫色 #533afd、深海军蓝、白色工作表面、浅灰表格内分隔线，无外边框，Inter 数字与紧凑 shadcn 控件。禁止黑色默认边框。
STORY: 先读实际收入趋势，再切换归因方式与收入范围，核对变化和模型成本，查看并导出逐日明细。
FIRST VIEWPORT: 桌面左侧 52px 图标栏，右侧为日期与端筛选；四模式工具条，下方约 8:5 的收入趋势与占比／成本对比，再接全宽明细。移动端堆叠，表格在自身区域横向滚动。
FORM: 用户指定 Stripe + Bento Data Viz，code-led Operate；无需概念抽签，seed key=user-pinned-stripe-bento。趋势日看近30天、周看12业务周、月看12月，明细独立比较所选业务周；月周图按真实已有日期计算日均。
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 扩展范围

全局导航默认窄图标栏，可展开；GMV 趋势采用三张带足够图形高度的指标卡和全宽趋势图，用户已拒绝重复数值的摘要带，不再添加。日明细支持预览与 CSV 导出；无收入模型保留成本，成本不按付费类型分配。
