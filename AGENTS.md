## 全局默认工程原则 Skill

当任务涉及代码编写、代码审查、重构、调试、测试或工程方案设计时，默认先读取并遵循 `/Users/ray/.codex/skills/karpathy-guidelines/SKILL.md`。先明确假设和可验证结果，采用最小必要改动，保留他人修改，避免无关重构。

## 用户背景与回答偏好

用户有 3 年大型互联网公司数据科学经验，日常工作覆盖产品分析、A/B 实验、复杂实验和营销运营因果推断，也制作数据科学课程、工具、教学材料与简历咨询内容。

撰写业务背景、目标、实验设计、策略、指标与建议时，优先中文金字塔结构：**核心结论：一句话概括。** 随后用共同支撑结论的加粗论点标题（以冒号结尾）与一至两句证据展开。不写“子论点 1”式标签，保持精简、业务化、可直接进入正式文档。

---

# 前端界面设计原则

Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining itself.

避免不必要的次级标签与解释文案。优先通过布局、分组和交互关系表达含义；仅在口径、缺失数据或操作后果会影响用户判断时补充说明。

看板布局优先采用紧凑的 Bento cards，充分利用空间，提高信息密度。

禁止出现突兀的黑色边框。导航、指标卡、图卡、下拉触发器、筛选控件和展开菜单统一不使用外边框；菜单以白色表面与柔和阴影区分层级。表格分隔线使用浅灰。键盘焦点使用紫色提示，不得依赖浏览器默认黑框。验收必须检查菜单展开态及键盘焦点态。

## 设计规范（每次界面改动前必读）

所有界面设计、实现、重构和审查，必须先阅读并遵循项目中的 [Stripe 设计规范](<stripe design.md>)，以其品牌色、文字、间距、线条和交互状态作为设计依据。`DESIGN.md` 是适配数据看板的组件规范，不得覆盖 Stripe 的品牌约束。

- 选中态使用统一浅灰底 `#f0f1f4`，悬浮态同样保持浅灰；不使用深灰色块。
- 选中标签的指示线使用品牌色 `#533afd`；分隔线使用 `#e3e8ee`，不得使用黑色指示线或边框。
- 默认按钮透明，只有明确的主操作使用品牌填充色。
- 数字与金额启用等宽数字；不增加无意义图标或次级说明文案。

## 本轮用户确认的界面约束（2026-11-22）

- 动态集中在右上角铃铛，角标取真实未读事件数；轮询同一事件不得重复计数，已读状态需保留。不要恢复浮动 toast 或首页底部更新通知条。
- 首页动作区使用“每日动态”与日期胶囊；图标复用现有 Kubai 资源。保持连续白色整版与浅灰分隔线，不拆出灰色沟槽；日历与每日动态同一行、共同收口。
- 支付链路先选人群，再拆解收入；注册新老为一级、创作分层默认收起。人群及子层必须可比较 GMV 变化贡献度，注明共同分母与零分母状态。
- 广告 Cohort 只使用注册日粒度。搜索复用已有 Bencho Search 的原位展开、自动聚焦和 Escape 交互；输入框不要叠加紫色内外框。
- 页头操作的图标与文字使用同一行居中对齐；链路诊断横跨下方整行，数据表与文字结论并排，避免长表下方只有单侧内容。

## V6.3 已实现体系与工程交付（WP10）

- 规范优先级：用户最新明确约束 → `stripe design.md` 品牌约束 → `DESIGN.md` 看板组件规范。唯一运行时 token：`src/themes/pollo-v62/tokens.css`；同步维护 DESIGN frontmatter 与 `.impeccable/design.json`（schemaVersion 2）。禁止按旧 Ledger/玻璃/三 KPI 文档还原 UI。
- `DESIGN.md` 已记录决定 D1–D14 的最新覆盖、真实 token、`shared/format.ts`、术语、共享组件、图表规则及九页结构。读取相关页面段落后再改实现。不要将支付链路的 GMV 贡献、指标变化贡献、支付效率/提交结构 pp 与净变化份额混为一个口径。
- 首页四等宽 KPI；ellipsis 点击打开 ActionNode；导出先看长/宽表再下载 CSV；90 天日历格不写数字。广告五等宽 KPI，注册日 Cohort 未成熟格分离留空，默认结论关闭，点击格弹性展开，Escape 恢复焦点，不联动国家表。链路结论白底、内部左分隔线、自然高度，与证据表并排。
- 率指标 tooltip 只展示绝对 pp 差；金额、数量及日值/日均指标展示绝对差与相对百分比，包含 GMV、CPC/CAC/LTV、人均任务和客单价；ROAS 保留 x 单位。提交支付率明确为支付人数 / 提交人数。贡献条高 8px、胶囊浅轨道、中心刻度，方向取绝对 effect。支持页面的 Android/iOS 用真实设备过滤；广告来源无 device 字段，不支持设备拆分的广告/明细查询仅保留 platform，但菜单仍展示 Android/iOS 禁用选项并说明仅 App 汇总，不得隐藏或伪造设备数据。
- 运行 `npm run lint:design`，严格目录为 pages、components/v62、components/system、components/charts，须为 0；legacy 计数单独披露。该脚本检查 hex、非规范字号/圆角、backdrop-filter，并不证明旧样式清理完毕。主题兼容别名仍在，不盲删。
- 新改文件使用 Prettier `printWidth: 120`。保留 DashboardPage 剩余职责记录、HomeKpis/HomeSignals 与 LmdiTable/FactorTrend 拆分；日诊断阅读器按需加载，不让 Mermaid/Shiki 回到首页初始图。旧选择器/文件只列候选，用户确认后才删除；根 Jest 配置不改，使用 Node 测试及 `design-review/v62/jest-review.config.json`。
- 仅在本地工作，不 commit/push、不丢弃他人修改、不自动删除。不得 `pollocloud deploy`、`pollocloud db execute`、`POLLO_REMOTE_DATA=1`、`npm run data:local` 或访问生产站；预览使用 `.local-data` 快照或 `VITE_DATA_MODE=demo`。验收不触发同步或生成报告。
- `.impeccable/config.json` 仅对独立公式块的 SFMono-Regular 字体检测豁免；正文仍用 Inter，不扩展豁免。当前严格 lint 为 0，legacy 尚有计数；初始图已隔离 Mermaid/Shiki，但大包警告仍存在。
- 当前九页 1440/1280 证据及最终 continuation ship 范围见 `design-review/v63-final/REVIEW-PACKET.md` 与 `FINISH-REVIEW.md`。截图不证明全部交互；OS reduced-motion 与 DevTools 外部请求审计未实测，不宣称已验证。

### V6.3 最新实现补充

- PaymentTrend 使用实际 Mebius `InvestmentPerformanceChart` 和配套 marker/tick 源组件，维持真实日/周/月/年日均、缺失断线、整数金额；图卡 `overflow: clip` 防止焦点造成滚动。PaymentShareDialog 范围为扁平 Segment，tooltip 仅紧凑日期和占比，离开隐藏。
- 广告点击国家行进入 880px CountryChannels，无单独重复入口；指标行点击/键盘联动下方趋势，基准期/分析期日期点击弹层留在 native dialog 内。CTR 变化为 pp，不显示相对百分数。
- 支付链路 header 不重复公式，定义保留 InfoTip、数量保留 cell；Kubai file-chart 表达结论，search 表达核查。LMDI 的 Table2 入口先开 960px ChainDetails，再由明细弹窗导出 CSV；交付记录已实测导出与 Escape 焦点恢复。
- WorkspaceHeader 使用 Kubai 的“分析工作台 / 诊断与管理 → 当前页”面包屑（权限/admin 正确归组）；个人账号位于铃铛右侧，侧栏底部无重复账号入口。此为最新明确覆盖，不得按旧“全站无面包屑”描述移除。
- 最新验收记录：type/build 通过，Node 236、SQL 15、WP0 15；严格 lint 0，legacy dashboard 1279 / bencho 109 / finance-chart 80。初始图 1,747,784 bytes、1,252 模块，无 Mermaid/Shiki，Reader 懒加载，大 chunk 警告仍在。OS reduced-motion 和独立 network audit 未实测；不要将已有截图等同这些验证。
