---
name: Pollo Stripe Revenue Workbench
description: Stripe 风格的紧凑收入分析工作台，紫色数据主线、白色 Bento 表面与可比较的密集明细。
colors:
  primary: "#533afd"
  ink: "#0d253d"
  muted: "#61718a"
  canvas: "#f4f6fa"
  surface: "#ffffff"
  surface-soft: "#f6f9fc"
  line: "#e3e8ee"
  selection: "#f0f1f4"
  segment-track: "#e9eef4"
  comparison: "#b3a9e8"
  cost: "#9b93cf"
  prior-period: "#b9b5c8"
  increase-fill: "#e4dfff"
  increase-stripe: "#cec5ff"
  decrease-fill: "#fbe2e9"
  decrease-stripe: "#efbecd"
  series-lavender: "#9884db"
  series-blue: "#347f9c"
  series-rose: "#ca809e"
  series-ochre: "#b18745"
  series-sage: "#729d94"
  positive: "#217451"
  positive-soft: "#edf8f2"
  negative: "#af354c"
  negative-soft: "#fdf1f3"
typography:
  headline:
    fontFamily: "'Inter Variable', Inter, 'PingFang SC', sans-serif"
    fontSize: "24px"
    fontWeight: 450
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  metric:
    fontFamily: "'Inter Variable', Inter, 'PingFang SC', sans-serif"
    fontSize: "clamp(24px, 2.4vw, 32px)"
    fontWeight: 450
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  title:
    fontFamily: "'Inter Variable', Inter, 'PingFang SC', sans-serif"
    fontSize: "13px"
    fontWeight: 550
    lineHeight: 1.4
    letterSpacing: "0"
  body:
    fontFamily: "'Inter Variable', Inter, 'PingFang SC', sans-serif"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "'Inter Variable', Inter, 'PingFang SC', sans-serif"
    fontSize: "11px"
    fontWeight: 400
  chart-label:
    fontFamily: "'Inter Variable', Inter, 'PingFang SC', sans-serif"
    fontSize: "10px"
    fontWeight: 400
rounded:
  change: "4px"
  control: "8px"
  panel: "22px"
  finance-panel: "22px"
  summary: "12px"
  pill: "999px"
spacing:
  micro: "4px"
  tight: "8px"
  compact: "12px"
  grid: "16px"
  panel: "20px"
  outer: "24px"
  wide: "28px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    height: "32px"
  income-select:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    width: "202px"
    height: "36px"
  floating-menu:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.control}"
  search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "34px"
    width: "224px"
  attribution-tabs:
    backgroundColor: "{colors.segment-track}"
    rounded: "{rounded.pill}"
    height: "38px"
    padding: "3px"
  workbench-picker:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 12px"
  workbench-segments:
    backgroundColor: "{colors.segment-track}"
    rounded: "{rounded.pill}"
    padding: "2px"
  navigation-item-active:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    width: "38px"
    height: "39px"
  metric-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
  change-positive:
    backgroundColor: "{colors.positive-soft}"
    textColor: "{colors.positive}"
    rounded: "{rounded.change}"
    padding: "3px 5px"
---

# Design System: Pollo Stripe Revenue Workbench

## Overview

**Creative North Star: "Stripe Revenue Workbench"**

Stripe 产品界面的克制与密度服务于重复收入诊断：深海军蓝建立阅读层级，紫色标记当前操作和主要数据，白色工作表面承载图形、金额与比较。导航、卡片、控件与菜单以表面和间距分区，不使用外边框。Bento 是有共同对齐关系的分析分组，卡片内的留白首先保障图形可读。

布局和直接交互表达关系，只在数据口径、缺失或操作后果影响判断时增加说明。付费类型、支付链路、创作与广告工作台延续同一世界；全局导航和 GMV 趋势保留各自已确认的表达。未迁移页面及通用主题中残留的旧墨色、旧紫色不构成新页面的配色授权。

**Key Characteristics:**
- 紫色主线与深海军蓝文字，白色图表表面。
- 紧凑 Bento、表格对齐与足够的绘图区高度。
- 默认窄图标导航，可按需展开。
- 导航、指标卡、图卡、控件与菜单无外边框；浅线仅保留内部结构。

## Colors

冷色中性色承托单一紫色强调；颜色用于选择、比较和业务状态。

### Primary
- **Stripe 紫色**（`primary`）：主要收入序列、当前归因模式、选中导航和主操作；保留白色图表底面。

### Secondary
- **灰色同期线**（`prior-period`）：主 GMV 的上周同期虚线；**淡紫比较色**（`comparison`）保留实体抽屉中的基准期线。
- **斜纹变化色**（`increase-fill`、`increase-stripe`、`decrease-fill`、`decrease-stripe`）：主 GMV 中，淡紫表示正变化、淡粉表示负变化，纹理不替代数值提示。
- **多实体分类色**（`series-*`）：付费页趋势用紫、薰衣草、蓝、玫瑰、赭、鼠尾草色区分同时展示的实体；图例与提示框保持对应。
- **成本薰衣草紫**（`cost`）：模型成本序列，和收入保持稳定映射。
- **业务状态**（`positive`、`negative`）：变化率文本；对应浅底只用于紧凑变化标记，不用于类别装饰。

### Neutral
- **海军墨色**（`ink`）：标题、金额和主要表格数值。
- **冷蓝灰**（`muted`）：轴、图例、单位与必要的口径说明。
- **画布与表面**（`canvas`、`surface`、`surface-soft`）：应用底面、白色卡片以及轻量工具条层级。
- **冷灰细线**（`line`）：表格内部行分隔、图形网格与零线；不用于导航、卡片、控件或菜单的外边框。
- **浅灰选中底**（`selection`）：导航、归因 Tab、颗粒度、长宽表切换及菜单选中项共用 `--selection-bg`，键盘焦点仍使用紫色；**分段轨道**（`segment-track`）承载白色激活项。

**The One Primary Rule.** 紫色用于主要数据、当前选择与关键操作；主 GMV 比较线使用灰色，模型成本使用薰衣草紫。多实体趋势可使用已定义的分类序列色区分曲线，不把分类颜色扩展成卡片主题。

## Typography

**Display Font:** Inter Variable / Inter；中文回退 PingFang SC。无单独装饰展示字体。
**Body Font:** 同一无衬线字体栈。
**Character:** 低对比字重承担层级，大金额轻于常规粗体；主 GMV 图内摘要为 24px、500 字重，600px 以下收为 20px；金额、比例、日期启用 `tabular-nums`，分析表面启用 `ss01`。

### Hierarchy
- **Headline**：页面标题。前置令牌记录付费类型的新样式；通用页头仍有旧字重，属于迁移范围差异。
- **Metric**：图卡金额。窄桌面收为 25px；GMV 趋势金额使用其已实现的 22–30px 流式范围。
- **Title**：图卡与明细区标题，强调结构，不添加额外眉题。
- **Body**：明细行和浮层内容。
- **Label**：筛选、单位、次级数值；**Chart label**：图例、坐标轴和紧凑表头。

**The Layout Explains Rule.** Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining itself.

## Layout

桌面内容最大宽度 1680px，外间距为上 24px、左右 28px、下 36px，区块间隔 18px。默认左侧窄图标栏，桌面主内容让出 72px；可展开完整导航。窄栏含 38×39px 图标入口，不通过隐藏入口压缩导航。

Bento 图卡采用共用基线和 16px 间隔。付费类型桌面图区约 1.6:1，1100px 以下收为 1.3:1，760px 以下单列；筛选换行、表格在自己的容器内横向滚动。付费多线趋势绘图区 224px；右侧分布／成本图可视区域 192px，实体抽屉走势图 230px；金额标题不占用绘图空间。具体页内顺序由 `.impeccable/surfaces/payment.md` 管理。

GMV 趋势的指标卡最小高度 216px，内部小图区域 148px、柱图区域 126px；下方趋势图使用独立全宽表面，三项摘要整合在该表面内。不要将这些高度压缩成仅供装饰的 sparkline。

链路与运营工作台继续使用独立白色表格 Bento 和 16px 间隔，宽表仅在本表容器内滚动。三个诊断入口等分整行、各自填满列宽，600px 以下单列；指标、变化与贡献保持对应位置。运营四指标桌面四列、1100px 以下两列；创作趋势与分层桌面约 1.4:1，1100px 以下上下排列。运营宽表保留固定表头，功能表同时固定首列，不以删除指标换取窄屏适配。

1000px 以下内容外间距为 20px；700px 以下为上 16px、左右 12px、下 74px，区块间隔 14px，为移动导航保留空间。诊断报告仍采用连续正文、桌面窄目录与文章栏，移动端目录置顶；不将分析卡片机械复制到阅读正文。

## Elevation & Depth

分析卡片静止时无阴影、无外边框；用白色表面、浅色背景与间距分组，浅线仅用于内部结构，浮层以柔和阴影表达临时层级。

### Shadow Vocabulary
- **浮层菜单**（`0 8px 24px rgb(13 37 61 / 10%)`）：Select、Popover、Dropdown 和成本说明浮层；无外边框。
- **选中分段**（`0 1px 3px #0d253d0d`）：白色激活项在浅色分段轨道中的轻微分离。
- **工作台移动底板**（`0 1px 2px rgb(13 37 61 / 10%)`）：Bencho Aspect 文字分段中的单一白色底板，不扩展为卡片阴影。
- **日期工具浮层**（`0 16px 36px rgba(37, 36, 61, .1)`）：已有自定义日期菜单，保持轻柔的临时层级。

**The Flat Work Surface Rule.** 分析卡片静止时无阴影、无外边框；用白色表面、浅色背景与间距分组，浅线仅用于内部结构，浮层以柔和阴影表达临时层级。

## Shapes

主分析卡采用柔和面板圆角，无外边框；紧凑按钮、提示和导航项采用控件圆角。归因分段、搜索、收入筛选使用胶囊形。图形保持白底，线下可使用紫色透明度渐变表达面积，这不是卡片背景装饰。

导航、指标卡、图卡、控件与菜单统一无外边框。表格内部保留浅灰分隔；键盘焦点是状态提示，不是永久容器边框。

## Components

### Buttons
紧凑、直接的动作入口。主按钮为紫底白字，常规最小高度 36px，水平内边距 16px；次级动作以 Ghost 呈现，紧凑高度 32px。主按钮沿用 shadcn 的轻微明暗反馈，禁用时降低透明度并禁用交互。可聚焦按钮使用紫色焦点提示。

### Chips
变化率使用小圆角、轻背景、文字状态色；正负色只解释变化方向，不对整张卡片染色。没有独立的装饰性结论徽章系统。

### Cards / Containers
白色、无外边框、静止无阴影；卡头上与左右内边距 20px，绘图区内容采用左右 12px、下 16px。表格卡复用同一外壳，不在每个单元格嵌套卡片。

### Inputs / Fields
搜索复用 Bencho 的原位展开交互：收起为 34px 图标入口，点击后同一表面展开至 224px 并聚焦输入；空值失焦收起，Escape 清空并收起。浅背景、无外边框，焦点使用浅紫光圈；减少动态效果时立即切换。下拉触发器常规高度 36px、分组筛选高度 32px；触发器和菜单的默认、悬停、展开状态均无外边框。付费类型的下拉聚焦以浅紫底提示，其余可交互元素使用 2px 紫色外轮廓、3px 偏移。

展开菜单使用白色表面与浮层阴影，选项焦点为浅紫底、选中内容为紫字；不能因为 portal 在页面树外而恢复黑框。

工作台单选复用 Bencho Picker 的展开交互和 HeroUI Button／Popover／ListBox：文字触发器不新增图标，当前值可见，`aria-label` 与控件名称一致；长列表可启用搜索。浮层通过 portal 向下、末端对齐，距触发器 6px，不翻向上方；宽度不超过 360px 或视口减 24px，列表内部滚动。方向键、Home／End、输入检索与 Enter／Space 完成选择；点击外部或 Escape 关闭，Escape 将焦点交回触发器。白色浮层使用面板圆角与既有浮层阴影。

Picker 从顶部末端展开：位移 −10→0px、横向缩放 .86→1、纵向 .72→1，弹簧 stiffness 460／damping 23／mass .9；逐行延迟从 30ms 起每项增加 40ms，最多累计至第六项。退出淡出 160ms；减少动态效果时立即呈现和关闭，不让长列表等待动画才能操作。

### Navigation
桌面默认图标栏；激活、悬停、键盘聚焦项使用浅紫底与紫色图标。图标采用 SVG，不以文字字符代替。可展开完整导航；移动端保留访问完整导航的能力。导航标签按需出现，不占据常态分析宽度。

### Segmented Controls
归因切换为浅灰胶囊轨道与白色激活项，激活文字紫色。付费趋势日／周／月保留紧凑分段；主 GMV 趋势采用日历图标下拉选择日／周／月，旁边的更多菜单收纳全部范围、数据明细及 CSV 导出。控件、展开菜单均无外边框。

工作台 IconBar 复用 Bencho Aspect 的单一移动底板，文字选项等宽，按钮高 32px，轨道内边距 2px；底板用 286ms `cubic-bezier(.22,1,.36,1)` 移至选中项。以具名 `group` 和按钮 `aria-pressed` 表达状态，只有当前项进入 Tab 顺序；方向键循环选择，Home／End 到首尾，Enter／Space 激活。减少动态效果时取消底板过渡与按压缩放。折叠模式直接复用 Picker 的 portal 和焦点生命周期，不另造向上菜单。

### Analytical Charts & Tables

图表提示值按单位统一格式：金额和人数显示整数，百分数固定一位小数，比率变化用绝对百分点。符号、颜色和数值共同表示变化方向，缺失值保留破折号。

**The Unit Follows Metric Rule.** 图卡切换指标时，主值、变化、坐标与 tooltip 同步切换单位；计数不带货币符号，百分比绝对变化用 pp，ROAS 用 x，cohort LTV 用美元／注册用户并保留两位小数。缺失和未成熟状态不能伪装成真实零值。

运营图表使用实际 Mebius 组件及业务数组：FinanceOverviewAreaChart 承载点击、成本、注册和 ROAS 四指标；前三项摘要为比较窗口日均，曲线为每日值，ROAS 为同窗口回收／成本。BalanceChart 承载创作单指标趋势，切换人数、任务、比率或回收时同步格式与日期。国家的渠道详情使用 GrowthTrendsChart，为收入、成本、点击及可计算的 ROAS 分别保留独立图面与单位，不将多个量纲挤入同一坐标轴。复用图表内部交互，不附加装饰图标、来源标签或重复摘要。

注册 cohort 矩阵按注册日期排列，列为来源实际支持的回收年龄；淡到深紫辅助数值比较，单元格仍直接显示 LTV。聚焦或点击同样可读 cohort、窗口、注册量、回收及 LTV，不依赖悬停。国家表按所选体量指标显示两期日均、绝对变化、环比及该指标总增量贡献。创作功能表复用 Picker 与日／周分段，保留原子量和比率；周比较的变化置于数值下方，UV 日均不标为周去重用户。

链路表的父子行共享金额与贡献列，切换首层维度保持 tier×lifecycle 作用域；嵌套 GMV 行的变化贡献仍以根合计增量为分母。五因子 GMV 贡献、诊断指标自身变化贡献以及转化的结构／效率效应保留各自语义，比例效应用 pp，不靠列对齐暗示它们可相加。零分母保留破折号。

付费分析加载时用白色空白表面保留图卡和明细高度，不使用紫色 Skeleton。
付费页按当前归因维度显示多实体折线，默认选中前四项，可搜索并选择其他实体，至少保留一个序列。日、周、月均为日均 GMV，周月按已有日期折算。曲线 2px、无常态点标记，缺失值不连接；Y 轴随实际范围留白，不低于零，不强制从零起画。图例和提示框直接显示实体与数值，不添加天数、来源口径或数据管道说明。

V2.3 业务数据在首帧可读。按用户要求，Global Finance Market Combo 与 Cash Flow Area 保留官方组件的光标移动、选点和形状过渡；渠道小图取消慢动作追赶。筛选反馈不阻塞读取数据。

共享 chart-motion 在布局阶段恢复完整 SVG 与精确数值；官方图表独立保留源代码规定的交互过渡。保留原有图形结构和键盘选点，避免为装饰效果增加全局指针事件或持续重绘。

GMV 主趋势复用用户提供的 Global Finance Market Combo SVG 组件。日颗粒度纵轴从零起，同轴展示本期紫色实线和上周同期灰色虚线（线宽 2px）；正负变化柱从同一绘图区底部向上绘制，高度为变化绝对值，淡紫／淡粉斜纹表示方向。周／月颗粒度仅显示本期单折线，纵轴按数据范围留白，不显示同期线、变化柱或三项摘要。没有独立变化条、第二纵轴或预测序列。

日颗粒度图内三项摘要依次为选中日（未选时为最新日）金额、可比日期较上周百分比、上周同期日均。第二项主数值前用 SVG 上／下箭头表示方向；不恢复最近一日右上读数。摘要采用浅背景、12px 圆角和 14px 内边距，不另加重复标题或说明。图表 SVG 设计坐标为 890×320，变化柱宽度最多 32px，并按相邻日期的实际像素间距收窄，留出柱间隙；顶部圆角最多 8px；斜纹是此组件的特征，不是全站卡片背景。悬停只移动光标与提示框；点击选择首项金额，之后悬停仍可继续查看其他点。第二、三项保留传入的区间增长和同期日均；同一点再点取消，Escape 清除，方向键选点。

付费类型非模型模式右图采用用户收藏的 Mebius Income Overview 条目交互：42px 浅灰轨道、紫色渐变条、逐行渐入与扫光；条长为分析期 GMV 占比（0–100%），悬停或键盘聚焦显示整数金额和一位小数占比，其他条淡化，点击固定，再次点击或 Escape 取消。行尾箭头进入实体明细。视窗高度 224px，全部项目可纵向滚动，不以 Top 5／6 截断。卡头显示分析期日均 GMV。模型模式保留 GMV 与薰衣草紫成本对比。收入筛选中的“全部收入”包含主动付费、自动续订与 API。

模型表在现有成本／成本占比单元格第二行显示变化，不新增列：成本为相对百分比，成本占比为绝对百分点（pp）；数字与变化右对齐，行内间隔 4px。

表格明确标注“分析期 GMV”和“基准期 GMV”。普通主体行高 44px，各 Tab 表头统一蓝灰 #eef3f9、11px／500 字重、高度 40px；固定首列表头不另染紫色，合计行 40px；名称左对齐、数值右对齐。名称行是明细入口，点击打开实体侧抽屉。详情三项指标使用等宽三列，固定标签／数值／变化三行（18／28／14px，行间隔 5px），避免金额与比例错位。详情趋势下拉切换 GMV、模型成本或成本占比，一次只比较该指标的分析期与基准期两条线，不将币值与比率混画。抽屉最大宽度 570px；逐日明细抽屉最大宽度 840px，均不超过视口。日明细支持长表和宽表：宽表行是当前实体、列是日期，首列固定，日期区域横向滚动；模型模式的宽表可切换 GMV／成本，两种形状均可下载。导出与翻页位于明细区域内，不增加全页摘要卡。

## Do's and Don'ts

### V2.3 约束

- 背景使用低对比冷白与淡紫环境光；玻璃感由浅白表面、微弱阴影和间距表达。正文保持 Stripe 深蓝，品牌紫强调当前操作和主要数据。
- 标题与通用筛选吸附，底部柔和消退；用实际标题高度设置滚动避让，浮层置于吸附层之上。
- 下钻默认收起，同一时刻展开一个诊断；先给业务结论，再给主要拖累／拉动及证据表。人数变化不直接推断渠道结构或根本原因。
- 比率采用分子、分母守恒的对称中点分解，分别展示组内效率与分母结构。方向贡献以净变化绝对值为分母，正向绿色、负向红色，零分母保留破折号；只有方向反转条件成立才提示辛普森悖论。
- 完整收入与成本金额显示整数，保留底层精度；紧凑单位、单客指标与比率按业务精度显示。厂商图标使用本地资源，未知模型使用中性标记。
- 日期使用 HeroUI 分段输入与范围日历，受真实数据覆盖约束，选择后实际更新查询。长列表在浮层内部滚动，嵌套浮层放在所属弹窗的滚动与焦点边界内。

### Do:
- Do 将金额、比较值与图形放进同一分析表面，让读者直接核对。
- Do 使用制表数字、右对齐数值和浅灰表格分隔线。
- Do 保证柱图和折线图有完整绘图区，移动端保留表格自身横向滚动。
- Do 检查菜单展开与键盘焦点态，使用紫色焦点提示。
- Do 仅对会影响判断的数据范围、缺失值和口径保留说明。

### Don't:
- Don't 给导航、指标卡、图卡、控件或菜单添加外边框，也不使用黑色默认框线。
- Don't 在收入概览主表面恢复旧环形图、独立右侧 KPI 卡或重复数字的分析摘要带；已落地的收入构成弹窗使用 Mebius ExpensesChart，不把这一局部构成图扩展为概览布局。
- Don't 用装饰性副标题、眉题或第二层标签补充布局已经表达的关系。
- Don't 将成本 / GMV 标为利润率，也不要用颜色掩盖无数据与真实零值的区别。
- Don't 将旧主题残留、黑色默认焦点或旧环形图样式写成新系统规范。

V2.3 收入趋势遵循官方组件：悬停只更新光标和提示框，点击选择首项金额；第二、三项不跟随指针。日期胶囊无可见标题；指标卡根据实际容器宽度将金额与小图上下排列。渠道商／厂商／模型共享品牌图标，Pollo 使用官网橙色 P；未知路由不推断厂商。

四个付费 Tab 的实体抽屉共用官方 Cash Flow Area Chart，使用真实逐日数据，紫色本期、灰色基准。绘图区保持 260px，高度不参与抽屉 Flex 压缩；下方构成表压紧至 28px 行高并使用剩余空间滚动。提示框限定在绘图区横向边界内。金额整数、成本占比为比率、变化为 pp，不混用货币单位。

模型成本图独立提供周／月／季度范围，分别读取最近 7／30／90 日窗口，与左侧日／周／月粒度无联动；实际覆盖不足时展示可用日期与日数。全局分析周日均的摘要不冒充范围累计值。指针离开后隐藏网格图的虚线指示器。

玻璃采用冷白底、微弱角部蓝紫环境色、半透明白色层和内侧高光，blur 18px、22px 圆角；正文深蓝，背景不承载高饱和装饰。表面亮度和数据对比优先于模糊效果。

## 看板问题修复约束（2026-11）

- 保留现有线上 Stripe 看板样式；只调整用户指出的布局与交互问题。
- GMV 指标卡展示所选范围内最新单日金额、日期与 WoW，折线覆盖所选范围，不再截断 30 天。
- 异动入口定位到具体日期的折线定位线；离开图表、失焦或 Escape 后收回，不使用呼吸灯。
- 产品动作仅匹配真实上线日期和端口；异动基线另读取所选范围前 98 天，不截短 12 个完整业务周。
- 达标且有同日同端动作的日期全部保留，不设数量或最小日期间隔上限；密集标记沿真实日期错行排列，复用原图标样式。
- 付费页标题使用共享标题字体与容器垂直布局；导航名称为“支付链路”。
- 血缘图采用 High-Level 总览与 Dependency Graph 明细，保留项目字体配色，窄容器内横向滚动。
