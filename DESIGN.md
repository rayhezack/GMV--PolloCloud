---
name: Pollo Decision Canvas
description: A restrained analytics interface with white working surfaces, deep ink text, and one purple interaction accent.
tokens:
  color:
    canvas: "#F7F7FA"
    surface: "#FFFFFF"
    surface_subtle: "#FAFAFC"
    ink: "#25243D"
    ink_muted: "#747487"
    line: "#E7E7EF"
    primary: "#5B3FF2"
    primary_hover: "#4930D9"
    primary_soft: "#EFECFF"
    chart_secondary: "#9B93CF"
    positive: "#2F7D5C"
    negative: "#C4515B"
    warning: "#A96F16"
  radius:
    control: "8px"
    panel: "12px"
  shadow:
    floating: "0 14px 36px rgba(37, 36, 61, 0.10)"
  typography:
    family: "Inter, PingFang SC, system-ui, sans-serif"
    numeric: "tabular-nums"
---

# Overview

Pollo Decision Canvas is a quiet working interface for repeated revenue diagnosis. White surfaces and fine cool-gray dividers carry the layout. Deep ink establishes hierarchy, while purple marks the current selection and the primary data series. Color communicates state or comparison and never decorates empty space.

# Colors

- Use `canvas` for the application background and `surface` for panels, cards, menus, and chart canvases.
- Use `ink` for headings and primary figures; use `ink_muted` for labels, help text, axes, and metadata.
- Use `primary` only for selected navigation, active controls, focus rings, primary actions, and the leading chart series.
- Use `primary_soft` for selected row backgrounds and active menu surfaces.
- Use `chart_secondary` for the second series in a direct comparison.
- Reserve `positive`, `negative`, and `warning` for their semantic meanings. Do not use them to distinguish ordinary categories.
- Do not use gradients, gray fills behind charts, or a different accent color for every card.

# Typography

- Use the system sans stack for all product UI.
- Page titles are 26-28px at 650 weight. Section titles are 16-18px at 650 weight. Compact panel titles are 12-14px at 600 weight.
- Primary metrics are 22-30px at 650 weight. Use tabular numerals for every amount, rate, count, and date.
- Keep letter spacing at zero. Use color and weight for hierarchy.

# Layout

- The sidebar is a stable navigation rail. Content uses a centered working canvas with 24-32px outer padding.
- Prefer continuous page sections and divided panels. Use cards only for repeated metric items or a true framed tool.
- Keep dense analytical content aligned to common columns. Put labels on the left and comparable values on the right.
- The payment type overview uses a two-column composition: donut and summary on the left, two primary contribution rows on the right. The active-payment drill uses four equal items below.
- Mobile layouts stack columns while preserving the same reading order.

# Elevation & Depth

- Structural panels rely on borders and spacing. They do not float.
- Menus, tooltips, and temporary controls may use the `floating` shadow.
- Do not add shadows to nested metric rows or table sections.

# Shapes

- Controls and compact items use an 8px radius.
- Major panels use a 12px radius.
- Pills are reserved for segmented controls, filters, badges, and compact status labels.
- Donut charts have a white center and no gray chart canvas.

# Components

- **Sidebar:** white surface, purple active rail and pale lavender active background.
- **Segmented controls:** pale neutral container, white active segment, purple active text or fill.
- **Metric menu:** two labeled groups. Automatic renewal reveals a plan-tier selector with All, Lite, Pro, and Ultra.
- **Charts:** white canvas, pale grid lines, purple primary series, muted lavender comparison series.
- **Tables:** white rows, subtle separators, pale lavender hover or selected state. Contribution bars share a zero baseline.
- **Payment type:** exactly two first-level rows and four active-payment drill items. Keep the donut and its legend visually attached.
- **Permissions:** manage members inside the dashboard. Authorization data must come from the platform AuthorizationSDK.

# Do's and Don'ts

- Do make selection, hierarchy, and comparison obvious before adding decoration.
- Do keep chart and card colors tied to the same tokens.
- Do use whitespace and alignment to separate analytical groups.
- Do not use teal, cyan, orange, pink, and purple together as category decoration.
- Do not place a tinted background behind the donut chart.
- Do not nest decorative cards inside a larger decorative card.
- Do not use oversized headings inside dense operational panels.

## 诊断报告 · 阅读界面

模式：Read。参照用户提供的白底博客布局；保留全站导航和紫色操作按钮，报告正文使用白底、深灰文字与细分隔线，不使用彩色百分比徽章、彩色结论卡或嵌套卡片。

桌面用窄目录栏与连续文章栏，窄屏目录移至顶部。阅读顺序为核心结论、原因判断、行动建议、数据与论证；原因详细论证和数据明细按需展开。正文限制行宽，14–16px、1.95行高，只有论点标题加粗。历史报告不自动补写未经生成的建议。
