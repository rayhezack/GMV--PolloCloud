"use client"

import { animate, stagger, utils, type JSAnimation } from "animejs"
import * as React from "react"

import { ChartButton } from "@/components/ui/chart-button"
import { ChartCard } from "@/components/ui/chart-card"
import { DotsHorizontalIcon } from "@/components/ui/chart-icons"
import { ChartLegendSwatch } from "@/components/ui/chart-legend-swatch"
import { ChartSegmentedControl } from "@/components/ui/chart-segmented-control"
import { ChartTrendsTooltipContent } from "@/components/ui/chart-trends-tooltip"
import { releaseStyles, useChartEntrance, useCountUp, useIsomorphicLayoutEffect, useReducedMotion } from "@/hooks/use-chart-motion"
import { useChartSize } from "@/hooks/use-chart-size"
import { useControllableState } from "@/hooks/use-controllable-state"
import { formatCompactCurrency, formatCurrency } from "@/lib/chart-format"
import { barTicks, fittedDash, seededRandom } from "@/lib/chart-series"
import { cn } from "@/lib/utils"

type FinancialTrendsSeries = "inflow" | "outflow"

/** One column of squares: the money that came in and went out over a stretch of time. */
type FinancialTrendsBucket = {
  /** Where the stretch starts: an ISO date ("2026-05-17") or date-time ("2026-12-21T06:00:00Z"), in UTC. */
  date: string
  /** Where it ends (exclusive). The next bucket's date by default; the last bucket is as long as the one before it. */
  end?: string
  inflow: number
  outflow: number
}

/** A segment of the control and the columns it shows. */
type FinancialTrendsPeriod = {
  value: string
  label: string
  /** One column per bucket, oldest first. */
  data: FinancialTrendsBucket[]
}

type FinancialTrendsChartProps = Omit<React.ComponentProps<"div">, "children"> & {
  title?: string
  /** The label over the big number: the period's money in minus money out. */
  totalLabel?: string
  /** Optional business summary; the plot always retains the actual bucket amounts. */
  coverageLabel?: string
  summaryValue?: number
  formatTooltipExtra?: (bucket: FinancialTrendsBucket) => React.ReactNode
  inflowLabel?: string
  outflowLabel?: string
  /** The segments of the control (Week, Month and Year by default) with their columns. */
  periods?: FinancialTrendsPeriod[]
  /** The shown period (a `value` of `periods`). */
  period?: string
  /** Year for the sample (Figma's months), else the first period. */
  defaultPeriod?: string
  onPeriodChange?: (period: string) => void
  /** The column the marker line and the tooltip are on (an index into the period's data). */
  index?: number
  /** The 13th column for the sample (17 to 28 May, as in Figma), else the latest. */
  defaultIndex?: number
  onIndexChange?: (index: number, bucket: FinancialTrendsBucket) => void
  /** Series taken off the grid; each legend item toggles its own. */
  hiddenSeries?: FinancialTrendsSeries[]
  defaultHiddenSeries?: FinancialTrendsSeries[]
  onHiddenSeriesChange?: (hidden: FinancialTrendsSeries[]) => void
  /** The tooltip's first line for a bucket (ms, the end exclusive): "May 17 – 28, 2026" by default. */
  formatSpan?: (start: number, end: number) => string
  /** Called by the ⋯ button. */
  onMoreClick?: () => void
  locale?: string
  currency?: string
}

type Span = { start: number; end: number }

// Figma geometry ("Financial Trends Chart" 1473:84375)
const ROWS = 15
const CELL = 12 // a square, 3px from the next one
const CELL_GAP = 3
const ROW_PITCH = CELL + CELL_GAP
const PLOT_HEIGHT = ROWS * ROW_PITCH - CELL_GAP // 222
const PLOT_WIDTH = 477 // 32 columns of 12px, 3px apart
const RADIUS = 3
const TICK_COUNT = 6 // labelled values, one every three rows
const LABEL_HEIGHT = 14
const TIP_GAP = 10 // the tooltip sits 10px right of the marker line (left of it near the end)…
const TIP_RISE = 18 // …its top 18px over the column's top, so its date row is level with it
const TIP_PADDING = 8 // its 4px padding, twice
const LABEL_CHAR = 7.5 // about how wide a character of Label/02 is
const LABEL_SPACE = 10 // the least space between two x labels
const MARKER_DASH = fittedDash(PLOT_HEIGHT) // 4/4 fitted to the 222px line, half a dash at each end
const DAY = 86_400_000
const HOUR = 3_600_000
const LIGHT_AT = 560
const MORPH = 600
const RING = "focus-visible:ring-primary-blue-500/40" // the card's focus rings are blue, like its outflow

const CELL_SLOT = '[data-slot="financial-trends-chart-cell"]'
// A square's state: 0 empty, 1 inflow, 2 outflow
const FILLS = ["fill-surface-disable", "fill-surface-soft", "fill-primary-blue-500"]
const COLOR_VARS = ["--surface-disable", "--surface-soft", "--primary-blue-500"]
const SERIES: { key: FinancialTrendsSeries; state: number; swatch: string }[] = [
  // Figma "Swatch": Background/Soft in a #e5e5e5 ring, blue-500 in a blue-500 ring
  { key: "inflow", state: 1, swatch: "bg-surface-soft [--swatch-ring:#e5e5e5]" },
  { key: "outflow", state: 2, swatch: "bg-primary-blue-500 [--swatch-ring:var(--primary-blue-500)]" },
]

const round = (n: number) => Math.round(n * 1000) / 1000
const cents = (n: number) => Math.round(n * 100) / 100
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10)
const isoTime = (time: number) => new Date(time).toISOString().replace(".000Z", "Z")

// The Figma card: 2026 in 32 stretches of 11 or 12 days (the columns that fit the 560px card), money in and out per
// stretch. On the $0–$50K axis every amount fills the squares Figma draws (one per $3,333.33, rounded: the outflow
// squares from the bottom, then the inflow ones), and the year nets Figma's $63,984.02. 17 to 28 May is the 13th.
const YEAR_STRETCHES: [number, number][] = [
  [7131.05, 4730.36], [7779.92, 7781.33], [10486.38, 8143.39], [7159.23, 4763.25], [7853.71, 7643.31], [10802.98, 11480.31],
  [10929.29, 8021.33], [7640.45, 7669.19], [14040.92, 7800.37], [7508.88, 11427.73], [11183.46, 11040.61], [10958.57, 14312.22],
  [10777.78, 17830.62], [10387.8, 11459.12], [17267.43, 7949.65], [17346.24, 11464.44], [14383.6, 17806.84], [20868.62, 14367.64],
  [27872.05, 11047.27], [20433.86, 21409.93], [20736.35, 14724.46], [10657.46, 11441.37], [7577.04, 7718.41], [10843.78, 7923.06],
  [14102.56, 11191.09], [14394.38, 14403.21], [14208.64, 11083.6], [14236.11, 7830.53], [10714.62, 4812.25], [10913.84, 4604.15],
  [11095.33, 11125.92], [11107.43, 14408.78],
]
const YEAR_START = Date.UTC(2026, 0, 1)
const STRETCH_DAYS = Array.from({ length: YEAR_STRETCHES.length + 1 }, (_, j) => Math.floor((j * 365) / YEAR_STRETCHES.length))
const SAMPLE_INDEX = 12

/** `total` shared out over `count` parts by `weights` (relative), to the cent, adding up exactly. */
function shareOut(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  const parts = weights.map((w) => cents((total * w) / sum))
  parts[parts.length - 1] = cents(total - parts.slice(0, -1).reduce((a, b) => a + b, 0))
  return parts
}

// Every day of 2026 (sample data): each stretch's amounts shared out over its days, so the month and the week below
// add up to what the year shows.
const SAMPLE_DAYS = (() => {
  const random = seededRandom(2026)
  const days: { time: number; inflow: number; outflow: number }[] = []
  YEAR_STRETCHES.forEach(([inflow, outflow], j) => {
    const length = STRETCH_DAYS[j + 1] - STRETCH_DAYS[j]
    const ins = shareOut(inflow, Array.from({ length }, () => 0.6 + 0.8 * random()))
    const outs = shareOut(outflow, Array.from({ length }, () => 0.6 + 0.8 * random()))
    for (let d = 0; d < length; d++) days.push({ time: YEAR_START + (STRETCH_DAYS[j] + d) * DAY, inflow: ins[d], outflow: outs[d] })
  })
  return days
})()

// A day's money in by six hours (night, morning, afternoon, evening), and out
const DAY_PARTS_IN = [0.06, 0.4, 0.4, 0.14]
const DAY_PARTS_OUT = [0.1, 0.32, 0.36, 0.22]

const sampleFinancialTrendsPeriods: FinancialTrendsPeriod[] = (() => {
  const random = seededRandom(1221)
  const december = SAMPLE_DAYS.filter((day) => day.time >= Date.UTC(2026, 11, 1))
  // Monday 21 to Sunday 27 December, the last full week, in six-hour stretches
  const week = SAMPLE_DAYS.filter((day) => day.time >= Date.UTC(2026, 11, 21) && day.time < Date.UTC(2026, 11, 28)).flatMap((day) => {
    const ins = shareOut(day.inflow, DAY_PARTS_IN.map((p) => p * (0.8 + 0.4 * random())))
    const outs = shareOut(day.outflow, DAY_PARTS_OUT.map((p) => p * (0.8 + 0.4 * random())))
    return ins.map((inflow, s) => ({ date: isoTime(day.time + s * 6 * HOUR), inflow, outflow: outs[s] }))
  })
  return [
    { value: "week", label: "Week", data: week },
    { value: "month", label: "Month", data: december.map((day) => ({ date: isoDay(day.time), inflow: day.inflow, outflow: day.outflow })) },
    {
      value: "year",
      label: "Year",
      data: YEAR_STRETCHES.map(([inflow, outflow], j) => ({
        date: isoDay(YEAR_START + STRETCH_DAYS[j] * DAY),
        end: isoDay(YEAR_START + STRETCH_DAYS[j + 1] * DAY),
        inflow,
        outflow,
      })),
    },
  ]
})()

/** An ISO date or date-time as ms (a bare date is midnight UTC). */
function parseTime(date: string) {
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date)
}

/** Whole calendar months from `a` to `b` when both are midnight on the 1st, else 0. */
function wholeMonths(a: number, b: number) {
  const x = new Date(a)
  const y = new Date(b)
  const first = (d: Date) => d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0
  return first(x) && first(y) ? (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth() : 0
}

/**
 * Each bucket's start and end (ms, the end exclusive). Without an `end` a bucket runs to the next one's start; the
 * last one is as long as the one before it (in calendar months when that one is whole months).
 */
function spansOf(data: FinancialTrendsBucket[]): Span[] {
  const starts = data.map((bucket) => parseTime(bucket.date))
  return data.map((bucket, j) => {
    const start = starts[j]
    const given = bucket.end ? parseTime(bucket.end) : NaN
    let next = start + DAY
    if (j < data.length - 1) next = starts[j + 1]
    else if (j > 0) {
      const months = wholeMonths(starts[j - 1], start)
      const d = new Date(start)
      next = months > 0 ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1) : start + (start - starts[j - 1])
    }
    const end = Number.isFinite(given) && given > start ? given : next > start ? next : start + DAY
    return { start, end }
  })
}

/**
 * The grid at a plot width. Every square stands for an equal amount (the axis' top over the 15 rows), so a column is
 * its outflow in squares from the bottom, then its inflow on top, each rounded at its stack's edge. The columns are
 * spread from edge to edge, 12px wide while there is room for 3px between them, narrower when there isn't.
 */
function layoutGrid(data: FinancialTrendsBucket[], hidden: FinancialTrendsSeries[], width: number) {
  const showIn = !hidden.includes("inflow")
  const showOut = !hidden.includes("outflow")
  const parts = data.map((bucket) => ({ inflow: showIn ? Math.max(0, bucket.inflow) : 0, outflow: showOut ? Math.max(0, bucket.outflow) : 0 }))
  const ticks = barTicks(Math.max(0, ...parts.map((part) => part.inflow + part.outflow)), TICK_COUNT)
  const unit = (ticks[ticks.length - 1] || 1) / ROWS
  const columns = parts.map((part) => {
    const outflow = Math.min(ROWS, Math.round(part.outflow / unit))
    return { outflow, total: Math.min(ROWS, Math.max(outflow, Math.round((part.outflow + part.inflow) / unit))) }
  })
  const n = data.length
  const cellWidth = round(n ? Math.max(1, Math.min(CELL, (width - (n - 1) * CELL_GAP) / n)) : CELL)
  const pitch = n > 1 ? (width - cellWidth) / (n - 1) : 0
  const xs = data.map((_, j) => round(n > 1 ? j * pitch : (width - cellWidth) / 2))
  return { ticks, columns, cellWidth, pitch, xs }
}

/** A square's state, `k` rows up from the bottom. */
const stateOf = (column: { outflow: number; total: number }, k: number) => (k < column.outflow ? 2 : k < column.total ? 1 : 0)
/** The top of a column's highest lit square (the plot's bottom for an empty column). */
const columnTop = (total: number) => (total > 0 ? PLOT_HEIGHT - total * ROW_PITCH + CELL_GAP : PLOT_HEIGHT)

const dateFormats = new Map<string, Intl.DateTimeFormat>()
function dateFormat(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${JSON.stringify(options)}`
  let format = dateFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" })
    dateFormats.set(key, format)
  }
  return format
}

/**
 * A bucket in words: a calendar month "May 2026", a day "Tue, Dec 22, 2026", part of a day "Tue, Dec 22, 6 AM – 12 PM",
 * several days "May 17 – 28, 2026".
 */
function defaultSpan(start: number, end: number, locale: string) {
  const a = new Date(start)
  const b = new Date(end)
  const midnight = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0
  const firstOfMonth = (d: Date) => midnight(d) && d.getUTCDate() === 1
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth()
  if (firstOfMonth(a) && firstOfMonth(b) && months === 1) return dateFormat(locale, { month: "long", year: "numeric" }).format(start)
  if (end - start < DAY) {
    const hour = dateFormat(locale, { hour: "numeric" })
    return `${dateFormat(locale, { weekday: "short", month: "short", day: "numeric" }).format(start)}, ${hour.format(start)} – ${hour.format(end)}`
  }
  if (midnight(a) && end - start === DAY) return dateFormat(locale, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(start)
  const format = dateFormat(locale, { month: "short", day: "numeric", year: "numeric" })
  return `${format.format(start)} – ${format.format(midnight(b) ? end - DAY : end - 1)}`
}

/**
 * The x labels for the buckets' time span: month names over a long period, every few days' date over a few weeks,
 * weekday names over a week, each centred on its stretch of the axis (a column's slot spans its bucket). Labels that
 * would touch the one before are left out, and the ones at the ends are kept inside the plot.
 */
function axisLabels(spans: Span[], xs: number[], cellWidth: number, pitch: number, width: number, locale: string) {
  const n = spans.length
  if (!n) return []
  const slot = n > 1 ? pitch : width
  const xAt = (time: number) => {
    let j = spans.findIndex((span) => time < span.end)
    if (j < 0) j = n - 1
    const { start, end } = spans[j]
    const left = xs[j] + cellWidth / 2 - slot / 2
    return left + Math.min(Math.max((time - start) / (end - start || 1), 0), 1) * slot
  }
  const from = spans[0].start
  const to = spans[n - 1].end
  const labels: { key: string; x: number; text: string }[] = []
  if (to - from >= 60 * DAY) {
    const month = dateFormat(locale, { month: "short" })
    const first = new Date(from)
    for (let index = first.getUTCFullYear() * 12 + first.getUTCMonth(); ; index++) {
      const start = Date.UTC(Math.floor(index / 12), index % 12, 1)
      const end = Date.UTC(Math.floor((index + 1) / 12), (index + 1) % 12, 1)
      if (start >= to) break
      const a = Math.max(start, from)
      const b = Math.min(end, to)
      // a month at the edge is named when at least half of it is shown
      if (b - a >= (end - start) / 2) labels.push({ key: `m${index}`, x: xAt((a + b) / 2), text: month.format(start) })
    }
  } else {
    const days = Math.ceil((to - from) / DAY)
    const weekdays = days <= 8
    const format = dateFormat(locale, weekdays ? { weekday: "short" } : { month: "short", day: "numeric" })
    const perDay = (xAt(from + days * DAY) - xAt(from)) / days || 1
    const widest = weekdays ? 3 : 6
    const every = weekdays ? 1 : ([1, 2, 3, 5, 7, 10, 14].find((k) => k * perDay >= widest * LABEL_CHAR + LABEL_SPACE) ?? 14)
    const start = Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth(), new Date(from).getUTCDate())
    for (let d = 0; start + d * DAY < to; d += every) {
      const day = start + d * DAY
      const a = Math.max(day, from)
      const b = Math.min(day + DAY, to)
      if (b > a) labels.push({ key: `d${day}`, x: xAt((a + b) / 2), text: format.format(day) })
    }
  }
  // keep the labels apart and inside the plot
  const kept: typeof labels = []
  let right = -Infinity
  for (const label of labels) {
    const half = (label.text.length * LABEL_CHAR) / 2
    const x = Math.min(Math.max(label.x, half), width - half)
    if (x - half < right + LABEL_SPACE) continue
    kept.push({ ...label, x: round(x) })
    right = x + half
  }
  return kept
}

/**
 * "Financial Trends Chart" from the Keitoto library: the period's total net cash flow over a dot matrix, one column of
 * squares per stretch of time, every square an equal amount: blue squares for the money that went out stacked from
 * the bottom, grey ones for what came in on top, on a $ axis. A dashed line marks the selected column and a tooltip
 * gives its dates and both amounts. Week, Month and Year switch the columns (six-hour stretches of the last week, the
 * days of the month, the year in 32 stretches), the legend items take a series off the grid (hovering one brings its
 * squares forward), hover or drag previews a column, a click or the arrow keys select one. Animated with anime.js: the
 * matrix ripples in, the squares light up column by column from the bottom while the total counts up, then the marker
 * line runs down and the tooltip pops in with its amounts counting; a new column slides the line and the tooltip over,
 * and new columns or series slide the columns into place and recolour the squares that change, bottom up.
 */
function FinancialTrendsChart({
  title = "Financial Trends",
  totalLabel = "Total net cash flow",
  summaryValue,
  coverageLabel,
  formatTooltipExtra,
  inflowLabel = "Cash inflow",
  outflowLabel = "Cash outflow",
  periods: periodsProp,
  period: periodProp,
  defaultPeriod,
  onPeriodChange,
  index: indexProp,
  defaultIndex,
  onIndexChange,
  hiddenSeries: hiddenProp,
  defaultHiddenSeries = [],
  onHiddenSeriesChange,
  formatSpan,
  onMoreClick,
  locale = "en-US",
  currency = "USD",
  className,
  ...props
}: FinancialTrendsChartProps) {
  const periods = periodsProp ?? sampleFinancialTrendsPeriods
  const [periodValue, setPeriod] = useControllableState({
    value: periodProp,
    // the sample opens on Figma's year, your data on its first period
    defaultValue: defaultPeriod ?? (periodsProp ? periods[0]?.value : "year") ?? "",
    onChange: onPeriodChange,
  })
  const period = periods.find((p) => p.value === periodValue) ?? periods[0]
  const data = React.useMemo(() => period?.data ?? [], [period])
  const n = data.length
  const spans = React.useMemo(() => spansOf(data), [data])
  const [indexValue, setIndex] = useControllableState({
    value: indexProp,
    defaultValue: defaultIndex ?? (periodsProp ? Math.max(0, n - 1) : SAMPLE_INDEX),
    onChange: (next: number) => {
      if (data[next]) onIndexChange?.(next, data[next])
    },
  })
  const [hidden, setHidden] = useControllableState<FinancialTrendsSeries[]>({ value: hiddenProp, defaultValue: defaultHiddenSeries, onChange: onHiddenSeriesChange })
  const [emphasis, setEmphasis] = React.useState<FinancialTrendsSeries | null>(null)

  const [plotRef, plot] = useChartSize<HTMLDivElement>({ width: PLOT_WIDTH, height: PLOT_HEIGHT })
  const width = plot.width || PLOT_WIDTH
  const { ticks, columns, cellWidth, pitch, xs } = React.useMemo(() => layoutGrid(data, hidden, width), [data, hidden, width])
  const labels = React.useMemo(() => axisLabels(spans, xs, cellWidth, pitch, width, locale), [spans, xs, cellWidth, pitch, width, locale])
  // Content keys: parents may pass new arrays on every render, so changes are detected by value.
  const gridKey = `${periodValue}|${columns.map((c) => `${c.outflow},${c.total}`).join(";")}`
  const ticksKey = ticks.join(";")
  const labelsKey = labels.map((label) => label.text).join(";")

  const [hovered, setHovered] = React.useState<number | null>(null)
  const [keyboardFocus, setKeyboardFocus] = React.useState(false)
  const tooltipVisible = hovered !== null || keyboardFocus
  const selected = n ? Math.min(Math.max(Math.round(indexValue), 0), n - 1) : -1
  const active = hovered !== null && hovered < n ? hovered : selected
  const bucket = data[active]
  const markerX = active >= 0 ? round(xs[active] + cellWidth / 2) : 0

  const money = React.useCallback((value: number) => formatCurrency(value, { locale, currency }), [locale, currency])
  const spanText = (j: number) => (spans[j] ? (formatSpan ? formatSpan(spans[j].start, spans[j].end) : defaultSpan(spans[j].start, spans[j].end, locale)) : "")
  const total = summaryValue ?? data.reduce((sum, b) => sum + b.inflow - b.outflow, 0)
  const labelOf = (key: FinancialTrendsSeries) => (key === "inflow" ? inflowLabel : outflowLabel)
  const shown = SERIES.filter((s) => !hidden.includes(s.key))
  const tooltip = bucket ? { date: spanText(active), rows: shown.map((s) => ({ id: s.key, label: labelOf(s.key), value: bucket[s.key], swatch: s.swatch })) } : null

  // The tooltip sits right of the marker line (left of it when it would run past the plot), its top 18px over the
  // column's highest square, kept inside the plot. Its size is measured on an invisible copy that holds the final text.
  const [sizerRef, sizer] = useChartSize<HTMLSpanElement>({ width: 212, height: 88 })
  const tipWidth = sizer.width + TIP_PADDING
  const tipHeight = sizer.height + TIP_PADDING
  const flipped = markerX + TIP_GAP + tipWidth > width
  const tipLeft = Math.round(flipped ? Math.max(0, markerX - TIP_GAP - tipWidth) : markerX + TIP_GAP)
  const tipTop = active >= 0 ? Math.round(Math.min(Math.max(columnTop(columns[active]?.total ?? 0) - TIP_RISE, 0), Math.max(0, PLOT_HEIGHT - tipHeight))) : 0

  const reduced = useReducedMotion()
  const root = React.useRef<HTMLDivElement>(null)
  const totalRef = React.useRef<HTMLParagraphElement>(null)
  const markerRef = React.useRef<SVGGElement>(null)
  const tipRef = React.useRef<HTMLDivElement>(null)
  const ids = React.useId().replace(/[^\w-]/g, "")
  const totalText = money(total)
  const latest = React.useRef({ total, totalText })
  useIsomorphicLayoutEffect(() => {
    latest.current = { total, totalText }
  })
  const all = (selector: string) => Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])
  /** A square state's colour, read from the theme (anime.js tweens colours, not CSS variables). */
  const colorOf = (state: number) => (root.current ? getComputedStyle(root.current).getPropertyValue(COLOR_VARS[state]).trim() : "") || "#f7f7f7"

  useCountUp(totalRef, total, money, { duration: 900 })

  // Entrance, once the card is in view: the title and the panel come in, the total counts up, the control, the legend
  // and the y labels follow; the empty matrix ripples in from the bottom left, then the squares light up column by
  // column from the bottom (outflow, then inflow) and the x labels rise; last the marker line runs down the selected
  // column and the tooltip pops in with its amounts counting up.
  useChartEntrance(root, (timeline) => {
    const totalEl = totalRef.current
    const tipValues = all('[data-slot="financial-trends-chart-tooltip"] [data-slot="chart-trends-tooltip-value"]')
    const counter = { total: 0, tip: 0 }
    const count = () => {
      if (totalEl) totalEl.textContent = money(latest.current.total * counter.total)
      tipValues.forEach((el) => (el.textContent = money(Number(el.dataset.value) * counter.tip)))
    }
    count()
    const cells = all(CELL_SLOT)
    const lit = cells.filter((cell) => cell.dataset.state !== "0")
    const empty = colorOf(0)
    const columnsCount = Math.max(1, n)
    const lastLit = Math.max(0, ...lit.map((cell) => Number(cell.dataset.col) * 26 + Number(cell.dataset.k) * 24))
    const shownAt = LIGHT_AT + Math.min(lastLit, 1100) + 200
    timeline
      .add(all('[data-slot="financial-trends-chart-heading"]'), { opacity: { from: 0 }, translateY: { from: 6 }, duration: 600, ease: "outQuad" }, 0)
      .add(all('[data-slot="chart-button"]'), { opacity: { from: 0 }, scale: { from: 0.8 }, duration: 600, ease: "outBack(1.7)" }, 60)
      .add(all('[data-slot="financial-trends-chart-panel"]'), { opacity: { from: 0 }, translateY: { from: 10 }, duration: 800, ease: "outExpo" }, 80)
      .add(all('[data-slot="financial-trends-chart-total-label"]'), { opacity: { from: 0 }, translateY: { from: 4 }, duration: 500, ease: "outQuad" }, 160)
      .add(counter, { total: [0, 1], duration: 1500, ease: "outExpo", onUpdate: count }, 180)
      .add(all('[data-slot="chart-segmented-control"]'), { opacity: { from: 0 }, translateX: { from: 8 }, duration: 600, ease: "outQuad" }, 220)
      // (handed back at the end: a hidden series' item fades by its class)
      .add(all('[data-slot="financial-trends-chart-legend-item"]'), { opacity: { from: 0 }, translateX: { from: -6 }, duration: 500, ease: "outQuad", delay: stagger(80), onComplete: releaseStyles("opacity", "transform") }, 280)
      .add(all('[data-slot="financial-trends-chart-tick"]'), { opacity: { from: 0 }, translateY: { from: 4 }, duration: 500, ease: "outQuad", delay: stagger(50, { from: "last" }) }, 320)
    // the squares hand their opacity and fill back to their classes (a legend item's hover fades a series by class)
    const ripple = cells.map((cell) => (Number(cell.dataset.col) * (32 / columnsCount) + Number(cell.dataset.k)) * 9)
    if (cells.length)
      timeline.add(cells, { opacity: { from: 0 }, duration: 320, ease: "outQuad", delay: (_, i) => ripple[i ?? 0] ?? 0, onComplete: releaseStyles("opacity") }, 300)
    const light = lit.map((cell) => Math.min(Number(cell.dataset.col) * 26 + Number(cell.dataset.k) * 24, 1100))
    if (lit.length)
      timeline.add(lit, { fill: { from: empty }, duration: 300, ease: "outQuad", delay: (_, i) => light[i ?? 0] ?? 0, onComplete: releaseStyles("fill") }, LIGHT_AT)
    timeline.add(all('[data-slot="financial-trends-chart-axis-label"] > span'), { opacity: { from: 0 }, translateY: { from: 4 }, duration: 500, ease: "outQuad", delay: stagger(40) }, LIGHT_AT + 200)
    if (markerRef.current) timeline.add(markerRef.current, { scaleY: { from: 0 }, duration: 700, ease: "outExpo" }, shownAt)
    if (tipRef.current) timeline.add(tipRef.current, { opacity: { from: 0 }, translateY: { from: 6 }, scale: { from: 0.94 }, duration: 500, ease: "outBack(1.6)" }, shownAt + 250)
    if (tipValues.length) timeline.add(counter, { tip: [0, 1], duration: 900, ease: "outExpo", onUpdate: count }, shownAt + 250)
    return () => {
      if (totalEl) totalEl.textContent = latest.current.totalText
      tipValues.forEach((el) => (el.textContent = money(Number(el.dataset.value))))
    }
  })

  // New columns, series or data: the columns slide to their new places (unless the card was resized) and every square
  // that changes recolours from what it shows, bottom up when it lights and top down when it empties.
  const grid = React.useRef({ key: gridKey, xs, states: columns.map((c) => Array.from({ length: ROWS }, (_, k) => stateOf(c, k))), width })
  const running = React.useRef<JSAnimation[]>([])
  useIsomorphicLayoutEffect(() => {
    const before = grid.current
    const states = columns.map((c) => Array.from({ length: ROWS }, (_, k) => stateOf(c, k)))
    grid.current = { key: gridKey, xs, states, width }
    if (before.key === gridKey || reduced) return
    running.current.forEach((animation) => animation.cancel())
    running.current = []
    if (before.width === width) {
      for (const column of all('[data-slot="financial-trends-chart-column"]')) {
        const j = Number(column.dataset.col)
        const from = before.xs[j]
        if (from === undefined) {
          running.current.push(animate(column, { opacity: [0, 1], duration: 400, ease: "outQuad", onComplete: releaseStyles("opacity") }))
          continue
        }
        const dx = from - xs[j] + utils.get(column, "translateX", false)
        if (Math.abs(dx) > 0.01)
          running.current.push(animate(column, { translateX: [dx, 0], duration: MORPH, delay: j * 6, ease: "outExpo", onComplete: releaseStyles("transform") }))
      }
    }
    const colors = [0, 1, 2].map(colorOf)
    for (const cell of all(CELL_SLOT)) {
      const j = Number(cell.dataset.col)
      const k = Number(cell.dataset.k)
      const to = states[j]?.[k] ?? 0
      const was = before.states[j]?.[k] ?? 0
      // a square still recolouring starts from the colour it shows
      const from = cell.style.fill || colors[was]
      if (!cell.style.fill && was === to) continue
      const delay = j * 10 + (to > 0 ? k : ROWS - 1 - k) * 22
      utils.set(cell, { fill: from })
      running.current.push(animate(cell, { fill: [from, colors[to]], duration: 320, delay, ease: "outQuad", onComplete: releaseStyles("fill") }))
    }
  }, [gridKey, width, reduced])
  React.useEffect(
    () => () => {
      running.current.forEach((animation) => animation.cancel())
    },
    [],
  )

  // New ticks or x labels fade in again.
  const lastLabels = React.useRef({ ticksKey, labelsKey })
  useIsomorphicLayoutEffect(() => {
    const before = lastLabels.current
    lastLabels.current = { ticksKey, labelsKey }
    if (reduced) return
    const tickEls = all('[data-slot="financial-trends-chart-tick"]')
    const labelEls = all('[data-slot="financial-trends-chart-axis-label"] > span')
    if (before.ticksKey !== ticksKey && tickEls.length)
      animate(tickEls, { opacity: [0, 1], translateY: [4, 0], duration: 450, delay: stagger(35, { from: "last" }), ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
    if (before.labelsKey !== labelsKey && labelEls.length)
      animate(labelEls, { opacity: [0, 1], translateY: [4, 0], duration: 450, delay: stagger(30), ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
  }, [ticksKey, labelsKey, reduced])

  const changePeriod = (next: string) => {
    if (next === periodValue) return
    const target = periods.find((p) => p.value === next)
    if (!target) return
    // keep the selected moment when the new period covers it, else select its latest column
    const time = spans[selected]?.start
    const nextSpans = spansOf(target.data)
    const at = time !== undefined ? nextSpans.findIndex((span) => time >= span.start && time < span.end) : -1
    setHovered(null)
    setIndex(at >= 0 ? at : Math.max(0, nextSpans.length - 1))
    setPeriod(next)
  }

  const toggleSeries = (key: FinancialTrendsSeries, item: HTMLElement) => {
    if (hidden.includes(key)) {
      setHidden(hidden.filter((s) => s !== key))
      return
    }
    // the last series shown stays: its item shakes instead
    if (shown.length <= 1) {
      if (!reduced) animate(item, { translateX: [0, -4, 4, -3, 3, 0], duration: 400, ease: "outQuad", onComplete: releaseStyles("transform") })
      return
    }
    setEmphasis(null)
    setHidden([...hidden, key])
  }

  const select = (next: number) => {
    if (!n) return
    setIndex(Math.min(Math.max(next, 0), n - 1))
  }
  const columnAt = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.currentTarget
    const box = target.getBoundingClientRect()
    // CSS zoom (the live demo scales wide demos down) scales the box but not the layout
    const zoom = box.width / (target.offsetWidth || box.width || 1) || 1
    const x = (event.clientX - box.left) / zoom
    return n > 1 && pitch > 0 ? Math.min(n - 1, Math.max(0, Math.round((x - cellWidth / 2) / pitch))) : 0
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(1, Math.round(n / 8))
    const next = { ArrowRight: selected + 1, ArrowUp: selected + 1, ArrowLeft: selected - 1, ArrowDown: selected - 1, PageUp: selected + page, PageDown: selected - page, Home: 0, End: n - 1 }[event.key]
    if (next === undefined || !n) return
    event.preventDefault()
    setHovered(null)
    select(next)
  }
  const describe = (j: number) =>
    data[j] ? `${spanText(j)}: ${inflowLabel.toLowerCase()} ${money(data[j].inflow)}, ${outflowLabel.toLowerCase()} ${money(data[j].outflow)}` : ""

  // two digits after the K where a step needs them ("$1.25K")
  const tickLabel = (tick: number) => formatCompactCurrency(tick, { locale, currency, maximumFractionDigits: 2 })
  // Each value sits on its row boundary (every third row); $0 and the top are kept inside the plot.
  const tickTop = (i: number) => {
    const rowsPerTick = ROWS / Math.max(1, ticks.length - 1)
    const middle = PLOT_HEIGHT - i * rowsPerTick * ROW_PITCH + CELL_GAP / 2
    return Math.round(Math.min(Math.max(middle - LABEL_HEIGHT / 2, 0), PLOT_HEIGHT - LABEL_HEIGHT))
  }

  return (
    <ChartCard
      ref={root}
      role="group"
      aria-label={title}
      // Figma: Background/Disable, 16px corners, 2px padding, a 1px #ebebeb ring and a soft drop shadow
      className={cn("w-full gap-0 rounded-2xl bg-surface-disable p-0.5 shadow-[0_1px_2px_rgb(40_40_40/0.08),0_0_0_1px_#ebebeb]", className)}
      {...props}
    >
      <div className="flex items-center justify-between gap-4 p-3">
        {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
        <p data-slot="financial-trends-chart-heading" className="typo-heading-01-semibold -my-0.5 min-w-0 truncate py-0.5 text-fg-loud">
          {title}
        </p>
        {onMoreClick && <ChartButton size="icon" aria-label="More options" onClick={onMoreClick}>
          <DotsHorizontalIcon />
        </ChartButton>}
      </div>

      <div
        data-slot="financial-trends-chart-panel"
        className="flex flex-col gap-6 overflow-hidden rounded-[14px] bg-surface-white p-4 shadow-[0_1px_2px_rgb(40_40_40/0.08),0_0_0_1px_#ebebeb]"
      >
        {coverageLabel && <p data-slot="financial-trends-coverage" className="text-xs text-fg-soft">{coverageLabel}</p>}
        {/* on a narrow card the control goes under the total */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="flex min-w-0 flex-[1_0_auto] flex-col items-start gap-3">
            {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
            <p data-slot="financial-trends-chart-total-label" className="typo-label-02-medium hug-w -my-0.5 max-w-full truncate py-0.5 text-fg-soft">
              {totalLabel}
            </p>
            <p ref={totalRef} className="typo-heading-03-semibold hug-w whitespace-nowrap text-fg-loud">
              {totalText}
            </p>
          </div>
          {periods.length > 1 && (
            <ChartSegmentedControl
              aria-label="Period"
              size="fit"
              value={period?.value}
              onValueChange={changePeriod}
              items={periods.map((p) => ({ value: p.value, label: p.label }))}
              className="shrink-0 [&_[data-slot=chart-segmented-control-item]]:focus-visible:ring-primary-blue-500/40"
            />
          )}
        </div>

        <div role="group" aria-label="Series" className="flex flex-wrap items-center gap-3 py-1">
          {SERIES.map((s) => {
            const off = hidden.includes(s.key)
            return (
              <button
                key={s.key}
                type="button"
                data-slot="financial-trends-chart-legend-item"
                aria-pressed={!off}
                onClick={(event) => toggleSeries(s.key, event.currentTarget)}
                onPointerEnter={() => !off && setEmphasis(s.key)}
                onPointerLeave={() => setEmphasis(null)}
                onFocus={(event) => {
                  if (!off && event.currentTarget.matches(":focus-visible")) setEmphasis(s.key)
                }}
                onBlur={() => setEmphasis(null)}
                className={cn("flex cursor-pointer items-center gap-1.5 rounded-md outline-none transition-opacity duration-200 focus-visible:ring-2", RING, off && "opacity-40")}
              >
                <ChartLegendSwatch size={10} className={s.swatch} />
                <span className="typo-label-02-medium hug-w whitespace-nowrap text-fg-normal">{labelOf(s.key)}</span>
              </button>
            )
          })}
        </div>

        <div className="flex items-start gap-3">
          {/* Figma "Y Axis Labels": 35px wide (wider labels widen it), each value on its row boundary, left-aligned */}
          <div aria-hidden className="relative hug-w min-w-[35px] shrink-0" style={{ height: PLOT_HEIGHT }}>
            {ticks.map((tick, i) => (
              <span
                key={tick}
                data-slot="financial-trends-chart-tick"
                className="typo-label-02-regular absolute left-0 whitespace-nowrap text-fg-soft"
                style={{ top: tickTop(i) }}
              >
                {tickLabel(tick)}
              </span>
            ))}
            {/* the widest label, invisible, gives the column its width */}
            <span className="typo-label-02-regular invisible block whitespace-nowrap">{tickLabel(ticks[ticks.length - 1] ?? 0)}</span>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div ref={plotRef} data-slot="financial-trends-chart-plot" className="relative" style={{ height: PLOT_HEIGHT }}>
              <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
                <defs>
                  {/* Figma "Marker Line": #171717 from 2% at the ends to 100% in the middle */}
                  <linearGradient id={`${ids}-marker`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={PLOT_HEIGHT}>
                    <stop offset="0" style={{ stopColor: "var(--fg-loud)", stopOpacity: 0.02 }} />
                    <stop offset="0.5" style={{ stopColor: "var(--fg-loud)", stopOpacity: 1 }} />
                    <stop offset="1" style={{ stopColor: "var(--fg-loud)", stopOpacity: 0.02 }} />
                  </linearGradient>
                </defs>
                {columns.map((column, j) => (
                  <g key={j} transform={`translate(${xs[j]} 0)`}>
                    <g data-slot="financial-trends-chart-column" data-col={j}>
                      {Array.from({ length: ROWS }, (_, k) => {
                        const state = stateOf(column, k)
                        const series = state === 2 ? "outflow" : state === 1 ? "inflow" : null
                        return (
                          // Figma "Bar": 12 × 12, 3px corners: Background/Disable, Background/Soft (inflow) or blue-500 (outflow)
                          <rect
                            key={k}
                            data-slot="financial-trends-chart-cell"
                            data-col={j}
                            data-k={k}
                            data-state={state}
                            x={0}
                            y={PLOT_HEIGHT - (k + 1) * ROW_PITCH + CELL_GAP}
                            width={cellWidth}
                            height={CELL}
                            rx={Math.min(RADIUS, cellWidth / 4)}
                            className={cn(FILLS[state], "transition-opacity duration-200", emphasis && series && series !== emphasis && "opacity-35")}
                          />
                        )
                      })}
                    </g>
                  </g>
                ))}
                {bucket && tooltipVisible && (
                  // a VECTOR stroke is centred on its path: 1px over [x - 0.5, x + 0.5]
                  <g transform={`translate(${markerX} 0)`}>
                    <g ref={markerRef} data-slot="financial-trends-chart-marker" className="origin-top [transform-box:fill-box]">
                      <line x1={0} x2={0} y1={0} y2={PLOT_HEIGHT} stroke={`url(#${ids}-marker)`} strokeWidth={1} {...MARKER_DASH} />
                    </g>
                  </g>
                )}
              </svg>

              {tooltip && (
                <div
                  ref={tipRef}
                  aria-hidden
                  data-slot="financial-trends-chart-tooltip"
                  className={cn(
                    "pointer-events-none absolute z-10 flex flex-col gap-2 overflow-hidden rounded-xl bg-surface-white p-1 whitespace-nowrap",
                    // Figma paints later effects on top; CSS paints the first shadow on top
                    "shadow-[0_0_0_1px_#f2f2f2,0_2px_4px_rgb(0_0_0/0.06),0_4px_16px_rgb(0_0_0/0.08)]",
                  )}
                  style={{ left: tipLeft, top: tipTop, visibility: tooltipVisible ? "visible" : "hidden" }}
                >
                  <ChartTrendsTooltipContent date={tooltip.date} rows={tooltip.rows} format={money} counting />
                  {bucket && formatTooltipExtra?.(bucket)}
                </div>
              )}
              {/* the same content with its final text, measured to place the tooltip (the visible amounts change width while they count) */}
              {tooltip && (
                <span ref={sizerRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex flex-col gap-2 whitespace-nowrap">
                  <ChartTrendsTooltipContent date={tooltip.date} rows={tooltip.rows} format={money} />
                  {bucket && formatTooltipExtra?.(bucket)}
                </span>
              )}

              <div
                role="slider"
                tabIndex={n ? 0 : -1}
                aria-label={`${title}: cash flow by column`}
                aria-orientation="horizontal"
                aria-valuemin={1}
                aria-valuemax={Math.max(1, n)}
                aria-valuenow={selected + 1}
                aria-valuetext={describe(selected)}
                data-slot="financial-trends-chart-scrubber"
                onPointerMove={(event) => setHovered(columnAt(event))}
                onPointerLeave={() => { setHovered(null); setKeyboardFocus(false) }}
                onBlur={() => { setHovered(null); setKeyboardFocus(false) }}
                onPointerUp={(event) => {
                  if (event.button === 0) select(columnAt(event))
                }}
                onKeyDown={(event) => { setKeyboardFocus(event.key !== "Escape"); onKeyDown(event) }}
                className={cn("absolute -inset-1 cursor-pointer touch-pan-y rounded-lg outline-none focus-visible:ring-2", RING)}
              />
            </div>

            {/* the x labels, each centred on its stretch of the axis */}
            <div aria-hidden className="relative h-3.5">
              {labels.map((label) => (
                <span key={label.key} data-slot="financial-trends-chart-axis-label" className="absolute top-0" style={{ left: label.x }}>
                  <span className="typo-label-02-regular block -translate-x-1/2 whitespace-nowrap text-fg-soft">{label.text}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ChartCard>
  )
}

export {
  FinancialTrendsChart,
  sampleFinancialTrendsPeriods,
  type FinancialTrendsBucket,
  type FinancialTrendsChartProps,
  type FinancialTrendsPeriod,
  type FinancialTrendsSeries,
}