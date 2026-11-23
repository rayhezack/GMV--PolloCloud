---
name: PolloCloud GMV V6.3
description: 连续白色整版的紧凑 GMV 归因看板
colors:
  canvas: '#f5f6f8'
  surface: '#ffffff'
  surface-sunken: '#f7f8fa'
  selected: '#f0f1f4'
  line: '#e3e8ee'
  text-1: '#0d253d'
  text-2: '#53627a'
  text-3: '#64748d'
  accent: '#533afd'
  accent-soft: '#f0edff'
  accent-pale: '#e9e3ff'
  positive: '#12804a'
  positive-soft: '#eaf6ee'
  negative: '#d33a43'
  negative-soft: '#fff0f0'
  negative-bar: '#f3aab0'
  warn: '#9a5b00'
  warn-soft: '#fff6e5'
  baseline: '#a6a6b2'
  residual: '#b8bfca'
  series-1: '#533afd'
  series-2: '#9b87d8'
  series-3: '#357fa4'
  series-4: '#bd6a8b'
  series-5: '#ad7b35'
  series-6: '#698e81'
  div-0: '#f3f4f6'
typography:
  kpi:
    fontFamily: 'Inter Variable, Inter, PingFang SC, -apple-system, sans-serif'
    fontSize: '28px'
    fontWeight: 500
    lineHeight: 1.2
  headline:
    fontFamily: 'Inter Variable, Inter, PingFang SC, -apple-system, sans-serif'
    fontSize: '20px'
    fontWeight: 600
  panel:
    fontFamily: 'Inter Variable, Inter, PingFang SC, -apple-system, sans-serif'
    fontSize: '15px'
    fontWeight: 600
  strong:
    fontFamily: 'Inter Variable, Inter, PingFang SC, -apple-system, sans-serif'
    fontSize: '14px'
    fontWeight: 500
  body:
    fontFamily: 'Inter Variable, Inter, PingFang SC, -apple-system, sans-serif'
    fontSize: '13px'
    fontWeight: 400
  meta:
    fontFamily: 'Inter Variable, Inter, PingFang SC, -apple-system, sans-serif'
    fontSize: '12px'
    fontWeight: 400
  reading:
    fontFamily: 'Inter Variable, Inter, PingFang SC, -apple-system, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.75
rounded:
  container: '16px'
  element: '10px'
  cell: '4px'
  full: '999px'
spacing:
  space-4: '4px'
  space-8: '8px'
  space-12: '12px'
  space-16: '16px'
  space-24: '24px'
  space-32: '32px'
components:
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.text-1}'
    rounded: '{rounded.element}'
    padding: '8px 12px'
  button-ghost-hover:
    backgroundColor: '{colors.selected}'
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.surface}'
    rounded: '{rounded.element}'
    padding: '4px 8px'
  search-field:
    backgroundColor: '{colors.selected}'
    textColor: '{colors.text-1}'
    rounded: '{rounded.element}'
  navigation-item:
    backgroundColor: 'transparent'
    textColor: '{colors.text-2}'
  navigation-item-selected:
    backgroundColor: '{colors.selected}'
    textColor: '{colors.text-1}'
  delta-positive:
    backgroundColor: '{colors.positive-soft}'
    textColor: '{colors.positive}'
    typography: '{typography.meta}'
    rounded: '{rounded.element}'
    padding: '4px 4px'
  kpi:
    textColor: '{colors.text-1}'
    typography: '{typography.kpi}'
  segmented-item-selected:
    backgroundColor: '{colors.selected}'
    textColor: '{colors.text-1}'
    rounded: '{rounded.element}'
  tooltip:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text-2}'
    typography: '{typography.meta}'
    rounded: '{rounded.element}'
  diverging-bar:
    backgroundColor: '{colors.positive}'
    rounded: '{rounded.full}'
    height: '8px'
---

# Design System: PolloCloud GMV V6.3

## Overview

**Creative North Star: “连续白色分析工作台”**。这是已实现界面的描述：紧凑 Bento 分区、深蓝文字、品牌紫数据与操作，依靠布局和细分隔线表达层级。首页用于每日监测，并将异动引导到支付链路；其余页面共享同一体系。

规范优先级：用户最新明确约束 → [Stripe 品牌规范](<stripe design.md>) → 本文看板组件规范。运行时 token 唯一来源是 `src/themes/pollo-v62/tokens.css`；上方 frontmatter 是该来源的可移植快照，修改主题后同步刷新。`themes/` 副本和 `--v62-*` 兼容别名不是第二套规范。本文替换旧 Ledger、玻璃与三 KPI 描述，不改变线上数据口径。

**Key Characteristics:** 连续白色表面；内部细线；制表数字；紧凑比较；按需展开证据。页面内容页头只放标题，面板只放标题、单位和必要比较口径；补充解释放入 InfoTip。工作台顶栏的当前位置面包屑另见 Layout，不在内容页头重复。

### 已拍板决定及后续覆盖

| 决定         | 当前约束                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| D1–D2        | 首页展示 GMV 趋势、异动线索、GMV 日历，并导向支付链路。                                                             |
| D3           | 趋势图不插产品动作旗标；动作在日历和每日动态中查询。                                                                |
| D4–D5        | 主趋势复用 Mebius Cash Flow；直线连接，Y 轴随数据范围自适应。                                                       |
| D6–D7        | 不做“分层 × 因子”矩阵；下钻从因子行展开；业务周保留 WeekComparisonPicker。                                          |
| D8–D10       | 付费构成、趋势、分布保留线上结构；Astryx 管理主题与通用控件；工作台图标复用 Kubai WorkbenchIcon。                   |
| D11–D13      | 首页是每日监测，不增加业务周控件、全局导出或广告/创作指标；支付链路主体为 LMDI，保留未归因差额；其余 Tab 同步体系。 |
| D14 最新覆盖 | 每日动态、产品日历入口保留；更新事件集中在右上铃铛，不恢复底部通知条或浮动 toast。                                  |

## Colors

### Primary

品牌紫 `accent` 用于本期曲线、主操作、选中指示线和键盘焦点；浅紫只用于数据热力、轻量强调。紫色不代替正文墨色。

### Secondary

正负语义色用于实际变化方向；`warn` 只提示覆盖、成熟度或解释风险。分类色 `series-1..6` 为紫、薰衣草、蓝、玫瑰、赭、鼠尾草，按实体固定映射，不随排名换色。广告渠道 CAC 为品牌紫，LTV 为薰衣草。

### Neutral

`canvas` 是应用底面；`surface` 是连续白色内容面与浮层；`surface-sunken` 用于轻轨道、合计和局部辅助区域；`selected` 用于通用选中/悬停。`text-1/2/3` 依次用于主值、标签、白底元信息。`line` 仅划分内部区域。`baseline` 为比较曲线，不用于正文；`residual` 表示未归因图形。

**The Direction Rule.** 发散条的方向与颜色由绝对影响 `effect` 决定，不能由贡献份额的符号决定；净下降时正份额仍可能向左。

热力顺序色 `seq-1..5` 为品牌紫混白 8%/18%/29%/40%/50%；发散色为正负语义色混白 12%/28%/48%，中心使用 `div-0`。它们的 CSS `color-mix` 定义仍由唯一 token 文件维护。未成熟与真实零不共用含义。

## Typography

**Body Font:** Inter Variable / Inter / PingFang SC / Apple 系统回退；字号和实际字重见 frontmatter。标题为 headline，面板为 panel，数值为 kpi，常规正文为 body，元信息为 meta。金额、人数、百分比与表格使用 `tabular-nums`，数值列右对齐；常规字重为 400/500/600。

报告和数据口径正文使用 reading（14px / 1.75）。数据页独立公式块使用 `ui-monospace, SFMono-Regular, monospace`，仍启用制表数字；`.impeccable/config.json` 只豁免 SFMono-Regular 的字体检测，不豁免正文、颜色、尺寸或其他规则。

### 格式化与术语

显示统一调用 `shared/format.ts`，舍入结果不得回流归因计算。

| 函数                            | 显示规则 / 示例                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `money` / `signedMoney`         | 整数千分位：`$143,717`；差额 `+$17,443` / `−$1,533`。                            |
| `count`                         | 人数、次数和日均人数取整：`6,722`。链路原子人数小于 1 时保留小数，避免伪造 0/0。 |
| `moneyCompact` / `countCompact` | KPI 或窄坐标使用 K/M，如 `$140K` / `48.4K`；不用于完整金额表。                   |
| `rate`                          | 输入小数，显示两位百分数：`0.312 → 31.20%`。                                     |
| `changePct`                     | 相对变化一位小数，箭头表示方向：`↗ 19.9%`。                                      |
| `changePp`                      | 比率绝对变化：`↗ 1.21 pp`，不能写成相对百分数。                                  |
| `share`                         | 有符号净变化贡献，一位小数，可为负或超过 100%：`−155.8%`。                       |
| `day` / `range`                 | `11/04 周三`、`10/31–11/04`；跨年带年份。                                        |
| 缺失 / 零                       | 缺失为 `—`，真实零为 `$0` / `0` / `0.00%`；零分母不可计算时显示 `—`。            |

使用“上周同日”“较前一日”“分析周 / 基准周”“较基准周”“日值 / 日均”“未归因差额”“业务周”。业务周为周六至周五；日期范围比较据真实窗口标“较前 N 天”，不冒称较上周同日。支付链路表头为“变化率”。**提交支付率 = 支付人数 / 提交人数**，与提交人群占比严格区分；分子先写。

## Layout

连续白色整版内使用紧凑 Bento 分区，不用灰色沟槽隔开卡片。WorkspaceHeader 顶栏使用 Kubai 图标的“分析工作台 / 诊断与管理 → 当前页”面包屑，权限/admin 路径归入诊断与管理；个人账号位于铃铛右侧，侧栏底部不重复放账号入口。PageHeader 内边距为 16px 24px，工具横向居中且可换行；正文常用 24px，局部 16px，细节使用 frontmatter 的间距阶梯。表格在自己的容器内横向滚动，浮层限于视口并允许内部纵向滚动。

首页四等宽 KPI，广告五等宽 KPI；共享 KpiStrip 的列数由页面覆盖，不能把默认三列视为首页约束。首页趋势/异动线索与 GMV 构成/诊断报告使用共享网格行，内部边界同步；日历与产品动作另起一行，日历格高 32px、行间距 6px，周围保留呼吸空间。链路上排 LMDI 与趋势，下排诊断横跨整行，表格和结论并排。结论白底、左侧内部细线、自然高度、随表吸附，不拉伸留白。广告上排左趋势右渠道，下排 Cohort，再下方国家表。

当前 CSS 在 850px 附近将主要双列切为单列；广告 Cohort 在 760px 以下纵向展开诊断。上述是实现规则，不构成移动端验收结论。当前审查证据覆盖 DOM 宽度 1440 和 1280。

## Elevation & Depth

默认表面平坦；导航、KPI、图卡、控件和菜单没有外边框。内容层级依靠白色、内部细线与留白；只有浮层使用 `shadow-floating`（`0 12px 40px rgb(13 37 61 / 0.12)`）。不使用玻璃模糊和深色卡片。

**The Floating Rule.** 菜单、弹窗、抽屉和提示框以白色表面及柔影分层；焦点用紫色提示，不依赖浏览器黑框。图表 tooltip 贴近光标，靠边翻转且避开标记点。

## Shapes

容器使用 container、内部控件使用 element、日历紧凑格使用 cell、轨道与细条使用 full。cell（4px）是已实现的日历专用 token，不是任意增加圆角档位。贡献条填充高 8px、两端圆润，放在浅色胶囊轨道内，以中心细刻度标零；条高不是圆角 token。所有外周边界保持无框。

## Components

表格表头统一白底、`text-3` 标题文字、500 字重与 `line` 底部分隔线；适用于主表、吸附表头、下钻抽屉和明细弹窗，不使用蓝色表头底色。

### 共享组件与状态

`client/src/components/system/` 统一提供以下组件；浮层和控件优先 Astryx。保留线上 WeekComparisonPicker、Bencho 原位搜索及 Mebius/SVG 图表这些已批准实现，仍使用语义 token，不新增第三方 UI 库。

| 组件                               | 结构与交互                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader` / `OperationalHeader` | 内容标题 + 工具，无副标题、不重复顶栏面包屑；图标与文字同一行居中。                                                                                                         |
| `DataFreshness`                    | “数据至 MM/DD”，进入更新详情；动态未读在铃铛去重计数，已读持久化。                                                                                                          |
| `PanelHeader` / `PeriodHeading`  | 标题、InfoTip 与工具；单位、聚合口径和比较日期放入提示，日期范围这类必要上下文可显式保留。基准期/分析期列的日期和覆盖天数放入对应表头提示。 |
| `KpiStrip` / `KpiItem`             | 标签/图标、数值与 DeltaBadge、细线与基准脚注；无内嵌迷你趋势；可选紫色指示线。                                                                                              |
| `DeltaBadge`                       | 正负语义文字与浅底，零与缺失保持中性；率差使用 pp。                                                                                                                         |
| `DataTable`                        | Astryx Table；total/row/child/residual；子行缩进 16px，数字右对齐，表头吸顶、首列按需吸左，支持排序。                                                                       |
| `DivergingBar`                     | `value` 控制份额长度，`effect` 控制实际方向；全表按非合计行最大绝对贡献共享 scaleMax，不以 100% 为下限。轨道 112px，紧凑链路/首页为 80px，不参与 flex 收缩；同表父子行等宽，root 实色、child 浅色、residual 斜纹。总计只写 100% 不画条。 |
| `PanelState`                       | loading 保留布局骨架；empty 写原因；partial 提示实际覆盖；error 提供重试。不得用 0 代替未成熟或缺失。                                                                       |
| `InfoTip` / `Modal`                | 统一口径提示、Dialog/Drawer；Escape 退出，保留触发点焦点生命周期。                                                                                                          |
| `Segment` / `PlatformSelect`       | 统一浅灰选中和悬停；App 下 Android/iOS 使用真实 deviceType SQL 过滤；广告/明细不支持设备时查询仅保留 platform；菜单仍展示 Android/iOS 但禁用，并说明数据源仅提供 App 汇总。 |

按钮默认透明，hover 为 selected；明确主操作才用品牌填充。原位搜索复用 Bencho：展开自动聚焦，Escape 收回，输入不叠加紫色内外框。菜单展开态与键盘焦点态都是验收项，不能只检查关闭截图。

### 图表

首页及相关分析共享 Cash Flow，付费类型 PaymentTrend 使用实际 Mebius InvestmentPerformanceChart，不能把两者文档化为同一组件。Cash Flow 改编自实际 Mebius 源码：直线本期紫色、比较灰色，面积轻填充；Y 轴随范围自适应且使用 niceTicks 左侧整齐刻度，量纲跟随指标。缺失断线，不补 0、不插值；日轴保留首尾和业务周定位，不逐日堆竖虚线。图中不插产品动作。选点保留光标和标记，提示框靠近且不盖住点；支持方向键、Home/End、Escape。

**The Unit Rule.** 率指标只显示绝对 pp 差，包含留存率、曝光率、提交率、支付率；即使调用方要求相对差也不能覆盖此规则。金额、数量及日值/日均指标展示绝对差与相对百分比，包括 GMV、日均 GMV、CPC、CAC、LTV、人均任务和客单价；共享 Cash Flow / Finance Overview 默认展示相对差；ROAS 显式关闭相对差并保留 x 单位，不套用百分比转化率口径。单位同步作用于主值、刻度、比较和 tooltip。

周/月不完整桶必须披露实际日数；有效基准按匹配业务日比较。无同日基准、零分母或未成熟应明确状态。官方图表标记跟随与选择动画保留，减少动态效果分支取消过渡；Cohort 诊断使用 spring（stiffness 320 / damping 29 / mass 0.8），reduced-motion 时 duration 0。系统级减少动态效果尚无独立实测证据。

付费类型的 InvestmentPerformanceChart 与实际安装的 chart-marker、chart-tick-label 源组件共同使用：保留真实逐日数据以及日/周/月/年日均聚合，缺失处断线，tooltip 金额调用整数 `money`，不靠示例序列替换数据。收入图卡采用 `overflow: clip` 防止聚焦控件时产生意外横向滚动。PaymentShareDialog 保留 NetWorthChart，范围切换使用扁平 Segment；tooltip 仅显示紧凑日期和占比，指针离开隐藏。

首页 BudgetChart 改编自 Mebius charts-budget：按选中日、当前端/设备的真实 `totalPayTypeGmv` 绘制 GMV 构成，保留 35 列、两行圆角格栅，类别边界按真实金额份额绘制，不将金额四舍五入成整格；类别用稳定的单一紫色色阶区分。图例仅保留色点与名称；金额和占比只在构成条悬浮或图例键盘聚焦时显示，离开或 Escape 收起。缺失不补零，源差额单列；负向金额不伪装成正向堆叠。上方趋势绘图区保留原高度。

### 九页结构

#### GMV 趋势（首页）

每日监测页由四等宽 KPI、趋势/异动两列和日历/每日动态两列组成。KPI 图标使用浅色底与清晰前景色，避免深色实底抢占数值注意力。KPI 是大盘 GMV、主动付费、自动续订、续订率；大盘和主动付费仅在真实订单数据存在时切换金额/订单。ellipsis 点击展开 ActionNode，hover 不展开；导出先进入长表/宽表明细弹窗，CSV 下载在弹窗内。日历默认最近 90 天；手动设置页头日期范围后跟随该范围，业务周列/星期行，格内无日期数字；hover/focus 读日期、金额、比较与动作数，点击日期更新右侧动态。

- 模块：PageHeader、HomeKpis、Cash Flow 趋势、BudgetChart 当日构成、HomeSignals/诊断报告、GMV 日历、产品动作、长宽表弹窗、铃铛更新入口。

#### 付费类型

保留线上四个归因 Tab 的收入趋势、GMV 分布和明细，趋势已接入实际 Mebius InvestmentPerformanceChart 及配套 marker/tick 组件。日/周/月/年维持真实日均与缺失断点，金额为整数；占比弹窗为扁平 Segment 与紧凑日期/占比 tooltip，离开图面收起。非模型分布不常驻金额/占比标签，hover/focus 看数值，点击条与箭头进入同一趋势面板；模型模式保留右侧完整分隔线及 GMV/成本比较。表格贡献条垂直居中；实体抽屉一次只画一个量纲，明细支持长宽表导出。

- 模块：PageHeader、业务周比较、端/设备筛选、归因 Tab、InvestmentPerformanceChart 趋势、分布/模型成本、PaymentShareDialog、实体表、实体趋势抽屉、逐日明细。

#### 支付链路

先选人群，再拆收入；主动链路注册新/老/未知为一级，创作分层默认收起。人群及子层的 GMV 变化贡献使用共同根合计增量分母，零分母显示不可计算。LMDI 表的变化率在 GMV 贡献之前，Table2 明细入口先打开 960px ChainDetails，再从弹窗内导出 CSV；Escape 关闭并恢复触发点焦点。单日和业务周复用同一下钻诊断；下排诊断表与白色金字塔结论并排。提交支付率拆为“支付效率”“提交结构”，展示整体 pp 变化及占整体净率变化的份额；负值与超过 100% 合法，净变化零时无份额，未解释影响单列。删除诊断 header 的重复公式，但保留 InfoTip 定义与 cell 中数量；结论使用 Kubai file-chart，核查使用 search，保持白底。

- 模块：PageHeader、单日/业务周比较、PopulationPicker、LmdiTable、FactorTrend、诊断证据 DataTable、DiagnosticConclusion、ChainDetails/CSV。

#### 创作积极性

四项 KPI 是创作渗透率、人均任务数、D3 留存率、任务采纳率。趋势与分层并排，分层保留独立业务周控件；下方功能表现按规模、转化、留存分组，日期倒序、首列与表头固定。成熟日期和缺失状态按来源呈现。

- 模块：OperationalHeader、四项 KPI、指标趋势、业务周创作分层、功能筛选、分组功能表现表。

#### 付费广告

五等宽 KPI 为点击、CPC、成本、CAC、LTV，点击 KPI 切左侧趋势；右侧渠道 CAC/LTV 独立使用 D0/D14/D30/D60/D90/D180 窗口，渠道图标 14px，LTV 薰衣草。注册日 Cohort 未成熟格留空并分离，不加斜纹/重复文字；默认诊断关闭，点击格子 spring 展开右侧结论，给出 LTV/CAC 覆盖或未成熟状态。关闭/Escape 返回原格焦点，不联动下方国家表、不加选中填色；渠道弹窗内容可纵向滚动。点击国家行进入 880px CountryChannels，不另放独立入口；指标表整行点击或键盘激活切换下方趋势。“基准期 / 分析期”点击显示实际日期及覆盖天数，弹层留在原生 dialog 内。CTR 的变化只显示 pp。广告来源没有 device 字段，Android/iOS 保留在菜单中但禁用，提示 App 汇总，不能合成设备拆分。

- 模块：OperationalHeader、五项 KPI、左趋势、右渠道 CAC/LTV、注册日 Cohort/诊断、国家变化表、渠道详情弹窗。

#### 明细数据

按数据集查询逐日数据，端、日期、搜索、排序、页码与 CSV 操作围绕表格组织；设备维度不支持时查询只保留 platform；Android/iOS 选项可见但禁用并说明 App 汇总，不能伪造设备拆分。空快照展示真实空态，不生成示例值。

- 模块：PageHeader、日期/端、数据集 Selector、搜索、DataTable、分页/每页条数、CSV。

#### 诊断报告

页头周期、端、创建/复制操作统一；左侧吸顶目录，右侧 14px/1.75 阅读正文。核心结论、原因判断、行动建议、数据与论证、数据口径按章节呈现，证据用 DataTable，箭头为 →。只有结构化字段才可提供 KPI，不能解析正文生成；当前不额外生成首屏 KPI。

- 模块：PageHeader、周期/端选择、报告操作、左目录、ReportInsightRenderer、证据 DataTable、口径披露。

#### 数据与口径

本页无无意义端选择和刷新；顶部紧凑 Astryx 同步控件，非管理员只显示一行只读说明。左侧吸顶目录，右侧正文与独立公式块，覆盖差异使用 DataTable。未归因水平占比和链路变化解释度分别定义，通过 InfoTip 关联，不当成同一指标。

- 模块：PageHeader、同步控制/只读说明、左目录、来源与覆盖、覆盖差异表、指标定义、独立公式、数据血缘。

#### 账号与权限

使用共享页头与账号权限表，仅当前权限导航项呈现选中态；保留既有权限行为，不因展示重构改变授权。

- 模块：PageHeader、账号工具、权限 DataTable、既有授权交互。

## Do's and Don'ts

### Do

- Do 先读 Stripe 与唯一主题 token；用语义 token、共享格式化和组件，检查实际查询及守恒。
- Do 保留未归因差额，分开 GMV 贡献、指标自身变化和率的结构/效率分解；不将同期动作认定为因果。
- Do 运行 `npm run lint:design`：严格检查 pages、v62、system、charts 下 hex、非规范字号/圆角、backdrop-filter，严格问题须为 0；旧 dashboard/bencho/finance-chart 只输出迁移计数。
- Do 将旧选择器/重复主题/UI 文件列为候选清单；需用户确认后删除。WP9 已采用 Prettier printWidth 120、HomeKpis/HomeSignals 与 LmdiTable/FactorTrend 拆分、日诊断阅读器按需加载，避免 Mermaid/Shiki 进入首页初始依赖图。
- Do 保留根 Jest 配置，使用 Node 测试和 `design-review/v62/jest-review.config.json` 验证数值、导航、日期、贡献方向与守恒。

### Don't

- Don't 恢复 Ledger、玻璃、灰色沟槽、外边框、黑色焦点、首页三 KPI、底部更新条或 hover 展开 KPI 动作。
- Don't 用永久金额标签重复分布图、把率的差值写为相对变化，或把广告未成熟格写成零。
- Don't 把严格设计 lint 为零解释为全仓已清理。旧样式和兼容组件仍在，候选未自动删除。
- Don't 仅凭截图宣称键盘全流程、系统 reduced-motion 或外部网络请求已通过；本轮留存 1440/1280 九页与交互证据；ChainDetails 导出/Escape 焦点恢复、创作页 iOS URL 切换有交付实测记录，其他项的审查范围见 `design-review/v63-final/FINISH-REVIEW.md` continuation ship。

当前记录：严格设计 lint 为 0，旧目录仍有 dashboard 1279 / bencho 109 / finance-chart 80 项。最新交付记录为 type/build 通过、Node 236、SQL 15、WP0 15 项通过；这些是工程验收记录，并非文档刷新重新执行。bundle audit 初始图为 1,747,784 bytes、1,252 模块，不含 Mermaid/Shiki，Reader 保持懒加载；仍存在大 chunk 警告；这不是性能问题全部解决的声明。公式字体单项豁免已披露；OS 减少动态效果和 DevTools 外部请求审计未实测。WP10 本身仅更新文档，不新增运行时验证承诺。

### 数据读取与性能（2026-11-23 修复）

各页日期取所选数据集和端的实际已入库范围，不能依赖最新同步任务的成功状态。首页主图默认 30 天、日历默认 90 天，手动设置页头范围后两者遵循同一筛选。付费注册下钻只在打开明细时按付费类型读取；主请求与明细浏览先在 SQL 汇总，避免传输隐藏 SKU 和 fields_json。`?perf=1` 为只记录耗时和资源大小的本地验收探针，以真实数据渲染完成作为 Tab 的计时终点。

模型归因表的成本两列只展示“模型成本变化”“成本占比变化”的相对百分数，实际金额与占比移入悬浮说明；此为这两列的明确相对变化口径，其他比率诊断仍使用 pp。提交支付率下钻单元格展示比率与对应提交结构占比，原子人数保留悬浮核查，基准/分析表头简化为期别。创作功能表全部层级表头使用相同浅灰背景。

创作模型与调用模型表保留 16px 模型图标及紧凑双向贡献条；变化列用单行带正负号的文本，不重复彩色胶囊和方向图标，仅当前排序列显示方向。报告抽屉与报告 Tab 复用同一阅读组件，组件显式绑定 Pollo 主题，核心结论竖线、编号及数字强调一致。

### 详情面板的日期联动（2026-11-23）

付费归因四种模式的实体/注册分层抽屉，以及广告国家渠道面板，默认保留原业务周对比。点击日趋势点，或方向键选点后按 Enter/空格，切换为所选日与上周同日；再次激活同一天或点击“恢复周对比”返回原业务周。悬浮只查看，不改表格。切换实体、国家、渠道或关闭面板清除单日选择；广告切换至周/月趋势时恢复周对比。表头、金额、比率、变化和贡献度一起重算；缺失比较日保留缺失状态，不补零。

注册分层趋势与表格共用按需加载的已核对数据，趋势只展示逐日金额核对通过的记录，不能因主表未携带注册切片而误报缺失。SKU 分层内同时显示当前周/日对比行。单日 payment-analysis 查询只读取所选的两个日期，成本和注册明细使用相同日期集合，周对比行为保持原样。

### 分析详情分列与加载状态（2026-11-23）

所有分析抽屉/明细弹窗的绝对变化、相对变化与贡献度分别占列。变化使用普通带正负号文字，不叠加箭头或彩色胶囊；率差仍用 pp，零基准的相对变化显示缺失。保留模型 16px 图标与紧凑双向贡献条；付费详情宽 960px，窄屏由表格横向滚动，避免压缩重叠。

切页代码加载与页面数据加载统一复用 LoadingWave；保持导航与布局，数据就绪立即显示，不设最低等待时间。遵循 reduced-motion，减少动态时停止波浪。
