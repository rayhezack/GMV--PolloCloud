"use client"

import { animate, stagger, type JSAnimation } from "animejs"
import * as React from "react"

import { ChartButton } from "@/components/ui/chart-button"
import { ChartCard } from "@/components/ui/chart-card"
import { ArrowCircleDownIcon, ArrowCircleUpIcon, ArrowUpRightIcon } from "@/components/ui/chart-icons"
import { ChartTrendsTooltipContent } from "@/components/ui/chart-trends-tooltip"
import { useChartEntrance, useCountUp, useIsomorphicLayoutEffect, useReducedMotion } from "@/hooks/use-chart-motion"
import { useChartSize } from "@/hooks/use-chart-size"
import { useControllableState } from "@/hooks/use-controllable-state"
import { formatCurrency, formatDay, formatPercent } from "@/lib/chart-format"
import { cn } from "@/lib/utils"

type GrowthTrendsColor = "green" | "purple" | "orange" | "blue"

/** One panel of the card: a monthly amount, its trend in bars and how this month compares. */
type GrowthTrendsMetric = {
  id: string
  /** The panel's heading ("Revenue growth"). */
  title: string
  /** What the amounts are, in the tooltip ("Revenue"). */
  label: string
  color?: GrowthTrendsColor
  /** One amount per month of `months` (as many), oldest first. Amounts below zero draw no bar. */
  values: number[]
}

type GrowthTrendsChartProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** The card's accessible name (the panels carry the visible titles). */
  formatValue?: (value: number, metric: GrowthTrendsMetric) => string
  title?: string
  /** The months the amounts belong to, as ISO dates of their first day ("2026-10-01"), oldest first. The last one is "this month". */
  months?: string[]
  /** One panel each, top to bottom. */
  metrics?: GrowthTrendsMetric[]
  /** How many months the bars show (the latest ones). Earlier months only feed the comparisons. */
  bars?: number
  /** The headline compares a month with the average of this many months before it. */
  compareMonths?: number
  /** The month the panels read (an index into `months`), or null for the latest month without a highlight. */
  index?: number | null
  defaultIndex?: number | null
  onIndexChange?: (index: number | null, month: string | undefined) => void
  /** Called by a panel's ↗ button. */
  onMetricClick?: (metric: GrowthTrendsMetric) => void
  /** The text after the badge for the latest month (other months show their name). */
  thisMonthLabel?: string
  /** The line under the headline: "Vs last 6 months" for 6 (fewer when the data starts later). */
  formatCompare?: (months: number) => string
  /** A month's name, after the badge and in the tooltip ("Oct 2026"). */
  formatMonth?: (month: string) => string
  locale?: string
  currency?: string
}

// Figma geometry ("Growth Trends Chart" 1473:84113)
const PLOT_WIDTH = 587
const PLOT_HEIGHT = 120 // the tallest bar of a panel reaches the top
const BAR_GAP = 8
const CAP = 2 // the solid line on top of each bar
const TIP_GAP = 8 // between the active bar and the tooltip
const TIP_PADDING = 8 // the tooltip's 4px padding, twice
const PANEL_STAGGER = 110
const BARS_AT = 250
const BAR_STAGGER = 45
const GROW = 900
const MORPH = 700

const BAR = '[data-slot="growth-trends-chart-bar"]'

const colors: Record<GrowthTrendsColor, { fill: string; stop: string; swatch: string; ring: string }> = {
  green: {
    fill: "fill-primary-green-500",
    stop: "var(--primary-green-500)",
    swatch: "bg-primary-green-500 [--swatch-ring:var(--primary-green-500)]",
    ring: "focus-visible:ring-primary-green-500/40",
  },
  purple: {
    fill: "fill-primary-purple-500",
    stop: "var(--primary-purple-500)",
    swatch: "bg-primary-purple-500 [--swatch-ring:var(--primary-purple-500)]",
    ring: "focus-visible:ring-primary-purple-500/40",
  },
  orange: {
    fill: "fill-primary-orange-500",
    stop: "var(--primary-orange-500)",
    swatch: "bg-primary-orange-500 [--swatch-ring:var(--primary-orange-500)]",
    ring: "focus-visible:ring-primary-orange-500/40",
  },
  blue: {
    fill: "fill-primary-blue-500",
    stop: "var(--primary-blue-500)",
    swatch: "bg-primary-blue-500 [--swatch-ring:var(--primary-blue-500)]",
    ring: "focus-visible:ring-primary-blue-500/40",
  },
}
const PALETTE: GrowthTrendsColor[] = ["green", "purple", "orange", "blue"]

const round = (n: number) => Math.round(n * 1000) / 1000
const cents = (n: number) => Math.round(n * 100) / 100
/** Figma's bar heights (px, the tallest 120) as amounts of `perPixel` each, to the cent. */
const amounts = (heights: number[], perPixel: number) => heights.map((h) => cents(h * perPixel))

// July 2025 to October 2026: six months of history, then the ten months the bars show (January to October 2026).
const sampleGrowthTrendsMonths = Array.from({ length: 16 }, (_, i) => {
  const m = 6 + i
  return `${2025 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`
})

// The Figma card: each panel's last ten amounts stand its bars as tall as Figma draws them (the tallest 120px), at
// the scale that keeps its badge's figure as October's change on September ($163,747, $48,975 and $863). The first
// six months are sample history for the comparisons.
const sampleGrowthTrendsMetrics: GrowthTrendsMetric[] = [
  {
    id: "revenue",
    title: "Revenue growth",
    label: "Revenue",
    color: "green",
    values: amounts([9, 10, 12, 11, 14, 15, 17, 28, 37, 52, 67, 76, 86, 97, 107, 120], 163747 / 13),
  },
  {
    id: "profit",
    title: "Profit trend",
    label: "Profit",
    color: "purple",
    values: amounts([44, 61, 38, 72, 51, 30, 17, 86, 52, 97, 28, 37, 76, 107, 120, 67], 48975 / 53),
  },
  {
    id: "expenses",
    title: "Expense efficiency",
    label: "Expenses",
    color: "orange",
    values: amounts([92, 70, 101, 84, 115, 98, 107, 97, 67, 17, 28, 120, 86, 37, 76, 52], 863 / 24),
  },
]

/** 6 → "Vs last 6 months", 1 → "Vs last month". */
function defaultCompare(months: number) {
  return months === 1 ? "Vs last month" : `Vs last ${months} months`
}

/** Where a panel's bars sit at a plot width: side by side 8px apart, as tall as their share of the largest. */
function layoutBars(values: number[], width: number) {
  const n = values.length
  const gap = Math.min(BAR_GAP, width / Math.max(1, n) * 0.3)
  const barWidth = n ? Math.max(1, (width - (n - 1) * gap) / n) : 0
  const max = Math.max(0, ...values.filter(Number.isFinite))
  const bars = values.map((value, i) => ({
    x: round(i * (barWidth + gap)),
    height: max > 0 && Number.isFinite(value) ? round((Math.max(0, value) / max) * PLOT_HEIGHT) : 0,
  }))
  return { barWidth: round(barWidth), pitch: barWidth + gap, bars }
}

/** Draws a bar `height` px tall: the 2px cap on top, the fading body under it. */
function drawBar(bar: Element, height: number) {
  const [cap, body] = Array.from(bar.children)
  const h = Math.max(0, height)
  const top = PLOT_HEIGHT - h
  cap?.setAttribute("y", String(round(top)))
  cap?.setAttribute("height", String(round(Math.min(CAP, h))))
  body?.setAttribute("y", String(round(top + Math.min(CAP, h))))
  body?.setAttribute("height", String(round(Math.max(0, h - CAP))))
}

/** The height a bar is drawn at (its cap's top). */
function drawnHeight(bar: Element) {
  const y = Number(bar.firstElementChild?.getAttribute("y"))
  return Number.isFinite(y) ? PLOT_HEIGHT - y : 0
}

type PanelProps = {
  metric: GrowthTrendsMetric
  color: GrowthTrendsColor
  /** The months' names. */
  names: string[]
  /** The first month the bars show. */
  first: number
  /** The month the panel reads, and the highlighted one (null: the latest, nothing highlighted). */
  active: number | null
  /** Whether this panel shows the tooltip (it is hovered or focused). */
  tip: boolean
  compareMonths: number
  thisMonthLabel: string
  formatCompare: (months: number) => string
  money: (value: number) => string
  whole: (value: number) => string
  growth: (value: number) => string
  onHover: (month: number | null) => void
  onSelect: (month: number) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onFocusChange: (focused: boolean) => void
  onOpen?: () => void
}

/** One panel: the heading and ↗ button, the month's figures on the left, its bars on the right. */
function Panel({
  metric,
  color,
  names,
  first,
  active,
  tip,
  compareMonths,
  thisMonthLabel,
  formatCompare,
  money,
  whole,
  growth,
  onHover,
  onSelect,
  onKeyDown,
  onFocusChange,
  onOpen,
}: PanelProps) {
  const values = metric.values
  const last = values.length - 1
  const shown = React.useMemo(() => values.slice(first), [values, first])
  const [plotRef, plot] = useChartSize<HTMLDivElement>({ width: PLOT_WIDTH, height: PLOT_HEIGHT })
  const width = plot.width || PLOT_WIDTH
  const { barWidth, pitch, bars } = React.useMemo(() => layoutBars(shown, width), [shown, width])
  const heightsKey = bars.map((bar) => bar.height).join(";")

  // The month the figures read: its amount, its change on the month before and the average of the months before it.
  const month = active ?? last
  const value = values[month] ?? 0
  const before = Math.min(Math.max(0, Math.round(compareMonths)), month)
  const previous = values.slice(month - before, month).filter(Number.isFinite)
  const base = previous.length ? previous.reduce((sum, v) => sum + v, 0) / previous.length : 0
  const headline = before > 0 && previous.length === before && Number.isFinite(value) && base !== 0 ? ((value - base) / Math.abs(base)) * 100 : null
  const change = month > 0 && Number.isFinite(value) && Number.isFinite(values[month - 1]) ? value - values[month - 1] : null
  const down = (change ?? 0) < 0
  const caption = month === last ? thisMonthLabel : (names[month] ?? "")
  const tone = colors[color]

  // The tooltip reads the current point directly.
  const shownMonth = active !== null && active >= first ? active : null
  const tipAt = shownMonth !== null && shownMonth >= first && shownMonth <= last ? shownMonth : null
  const tipBar = tipAt !== null ? bars[tipAt - first] : undefined
  const tipText = tip && tipAt !== null ? { date: names[tipAt] ?? "", rows: [{ id: metric.id, label: metric.label, value: values[tipAt] ?? 0, swatch: tone.swatch }] } : null
  const visible = tip && shownMonth !== null

  // The tooltip sits right of the bar (left of it near the plot's end), its middle level with the bar's top, kept
  // inside the plot. Its size is measured on an invisible copy that holds the final text.
  const [sizerRef, sizer] = useChartSize<HTMLSpanElement>({ width: 184, height: 62 })
  const tipWidth = sizer.width + TIP_PADDING
  const tipHeight = sizer.height + TIP_PADDING
  const flipped = tipBar ? tipBar.x + barWidth + TIP_GAP + tipWidth > width : false
  const tipLeft = tipBar ? Math.round(flipped ? Math.max(0, tipBar.x - TIP_GAP - tipWidth) : tipBar.x + barWidth + TIP_GAP) : 0
  const tipTop = tipBar ? Math.round(Math.min(Math.max(PLOT_HEIGHT - tipBar.height - tipHeight / 2, 0), Math.max(0, PLOT_HEIGHT - tipHeight))) : 0

  const reduced = useReducedMotion()
  const panelRef = React.useRef<HTMLElement>(null)
  const headlineRef = React.useRef<HTMLParagraphElement>(null)
  const changeRef = React.useRef<HTMLSpanElement>(null)
  const gradient = `growth-trends-${React.useId().replace(/[^\w-]/g, "")}`
  const all = (selector: string) => Array.from(panelRef.current?.querySelectorAll<SVGGElement>(selector) ?? [])

  // Hover only changes two bar opacities; the SVG geometry stays memoized.
  const barLayer = React.useMemo(() => (<svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
            <defs>
              {/* Figma: the colour at 40% under the cap, fading out to the bottom of each bar */}
              <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: tone.stop, stopOpacity: 0.4 }} />
                <stop offset="1" style={{ stopColor: tone.stop, stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            {bars.map((bar, i) => {
              const m = first + i
              const h = bar.height
              const top = PLOT_HEIGHT - h
              return (
                <g
                  key={i}
                  data-slot="growth-trends-chart-bar"
                  data-h={h}
                  data-month={m}
                >
                  <rect x={bar.x} y={round(top)} width={barWidth} height={round(Math.min(CAP, h))} className={tone.fill} />
                  <rect x={bar.x} y={round(top + Math.min(CAP, h))} width={barWidth} height={round(Math.max(0, h - CAP))} fill={`url(#${gradient})`} />
                </g>
              )
            })}
          </svg>), [bars, barWidth, gradient, tone, first])
  const highlighted = React.useRef<number | null>(null)
  useIsomorphicLayoutEffect(() => {
    const previous = highlighted.current
    highlighted.current = active
    const groups = all(BAR)
    if (previous === null || active === null) {
      groups.forEach((bar, i) => { bar.style.opacity = active === null || first + i === active ? "1" : ".35" })
    } else if (previous !== active) {
      groups[previous - first]?.style.setProperty("opacity", ".35")
      groups[active - first]?.style.setProperty("opacity", "1")
    }
  }, [active, bars, first])

  // Show exact business figures immediately when the selected day changes.
  useCountUp(headlineRef, headline ?? 0, growth, { enabled: headline !== null, duration: 700 })
  useCountUp(changeRef, Math.abs(change ?? 0), whole, { duration: 700 })

  // New data grows or shrinks every bar from the height it is drawn at (the entrance, while it runs, keeps drawing).
  const morphs = React.useRef<JSAnimation[]>([])
  const lastHeights = React.useRef(heightsKey)
  useIsomorphicLayoutEffect(() => {
    const before = lastHeights.current
    lastHeights.current = heightsKey
    if (before === heightsKey) return
    morphs.current.forEach((morph) => morph.cancel())
    morphs.current = []
    all(BAR).forEach((bar, i) => {
      const to = bars[i]?.height ?? 0
      const growing = bar.dataset.grow
      if (growing !== undefined) {
        drawBar(bar, to * Number(growing))
        return
      }
      const from = drawnHeight(bar)
      if (reduced || from === to) {
        drawBar(bar, to)
        return
      }
      const state = { h: from }
      drawBar(bar, from)
      morphs.current.push(animate(state, { h: to, duration: MORPH, delay: i * 35, ease: "outExpo", onUpdate: () => drawBar(bar, state.h) }))
    })
  }, [heightsKey, reduced])
  React.useEffect(
    () => () => {
      morphs.current.forEach((morph) => morph.cancel())
    },
    [],
  )

  // Tooltip coordinates come directly from the hovered bar, without trailing tweens.

  /** The month under a pointer: the nearest bar's slot. */
  const monthAt = (event: React.PointerEvent<HTMLElement>) => {
    // The empty scrubber is the event target and extends 4px beyond the plot.
    // Native offsetX is already in local CSS pixels, including under CSS zoom;
    // no synchronous layout read is needed after the previous hover update.
    const x = event.nativeEvent.offsetX - 4
    const i = Math.round((x - barWidth / 2) / (pitch || 1))
    return first + Math.min(Math.max(i, 0), Math.max(0, shown.length - 1))
  }

  const describe = (m: number) => {
    const delta = m > 0 ? values[m] - values[m - 1] : null
    return `${names[m]}: ${metric.label} ${money(values[m] ?? 0)}${delta !== null ? `, ${delta < 0 ? "down" : "up"} ${whole(Math.abs(delta))} on the month before` : ""}`
  }

  return (
    <section ref={panelRef} aria-label={metric.title} data-slot="growth-trends-chart-panel" className="@container flex flex-col overflow-hidden rounded-[20px] bg-surface-white p-5">
      <div className="flex items-center justify-between gap-4 pb-3">
        {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
        <p data-slot="growth-trends-chart-heading" className="typo-heading-01-semibold -my-0.5 min-w-0 truncate py-0.5 text-fg-loud">
          {metric.title}
        </p>
        <ChartButton size="icon" corner="rounded" aria-label={`Open ${metric.title.toLowerCase()}`} onClick={onOpen} className={tone.ring}>
          <ArrowUpRightIcon />
        </ChartButton>
      </div>

      {/* Figma "Value Row": the figures in a 293px column, the bars in the rest; on a narrow panel the bars go under them */}
      <div className="flex items-start pt-2 pb-3 @max-[34rem]:flex-col @max-[34rem]:items-stretch @max-[34rem]:gap-5">
        <div className="flex w-[293px] shrink-0 flex-col justify-between gap-2 self-stretch @max-[34rem]:w-auto">
          <div className="flex flex-col items-start gap-2">
            <p ref={headlineRef} data-slot="growth-trends-chart-headline" data-value={headline ?? undefined} className="typo-heading-04-semibold hug-w whitespace-nowrap text-fg-loud">
              {headline !== null ? growth(headline) : "–"}
            </p>
            <p data-slot="growth-trends-chart-note" className="typo-label-02-medium hug-w whitespace-nowrap text-fg-soft">
              {before > 0 ? formatCompare(before) : "No earlier months"}
            </p>
          </div>
          {change !== null && (
            <div className="flex items-center gap-2">
              {/* Figma "Change Badge": the change on the month before, green-500 on green-50 (error-500 on error-50 when it fell) */}
              <span
                data-slot="growth-trends-chart-badge"
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5",
                  down ? "bg-error-50 text-error-500" : "bg-primary-green-50 text-primary-green-500",
                )}
              >
                <span data-slot="growth-trends-chart-badge-icon" className="flex">
                  {down ? <ArrowCircleDownIcon className="size-3 shrink-0" /> : <ArrowCircleUpIcon className="size-3 shrink-0" />}
                </span>
                <span className="sr-only">{down ? "Down " : "Up "}</span>
                <span ref={changeRef} data-slot="growth-trends-chart-change" data-value={Math.abs(change)} className="typo-label-01-medium hug-w whitespace-nowrap">
                  {whole(Math.abs(change))}
                </span>
              </span>
              <p data-slot="growth-trends-chart-note" className="typo-label-02-medium hug-w min-w-0 truncate text-fg-soft">
                {caption}
              </p>
            </div>
          )}
        </div>

        <div ref={plotRef} data-slot="growth-trends-chart-plot" className="relative min-w-0 flex-1 @max-[34rem]:flex-none" style={{ height: PLOT_HEIGHT }}>
          {barLayer}

          {tipText && (
            <div
              aria-hidden
              data-slot="growth-trends-chart-tooltip"
              className={cn(
                "pointer-events-none absolute z-10 flex flex-col gap-2 overflow-hidden rounded-xl bg-surface-white p-1 whitespace-nowrap",
                // Figma paints later effects on top; CSS paints the first shadow on top
                "shadow-[0_0_0_1px_#f2f2f2,0_2px_4px_rgb(0_0_0/0.06),0_4px_16px_rgb(0_0_0/0.08)]",
                !visible && "opacity-0",
              )}
              style={{ left: tipLeft, top: tipTop }}
            >
              <ChartTrendsTooltipContent date={tipText.date} rows={tipText.rows} format={money} counting />
            </div>
          )}
          {/* the same content with its final text, measured to place the tooltip (the visible amount changes width while it counts) */}
          {tipText && (
            <span ref={sizerRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex flex-col gap-2 whitespace-nowrap">
              <ChartTrendsTooltipContent date={tipText.date} rows={tipText.rows} format={money} />
            </span>
          )}

          <div
            role="slider"
            tabIndex={0}
            aria-label={`${metric.label}趋势数据`}
            aria-orientation="horizontal"
            aria-valuemin={1}
            aria-valuemax={Math.max(1, shown.length)}
            aria-valuenow={month - first + 1}
            aria-valuetext={describe(month)}
            data-slot="growth-trends-chart-scrubber"
            onPointerMove={(event) => onHover(monthAt(event))}
            onPointerLeave={() => onHover(null)}
            onPointerUp={(event) => {
              if (event.button === 0) onSelect(monthAt(event))
            }}
            onKeyDown={(event) => {
              // keys show the tooltip too (focus by script or after a click doesn't count as focus-visible)
              if (event.key !== "Tab") onFocusChange(true)
              onKeyDown(event)
            }}
            onFocus={(event) => {
              if (event.currentTarget.matches(":focus-visible")) onFocusChange(true)
            }}
            onBlur={() => onFocusChange(false)}
            className={cn("absolute -inset-1 cursor-pointer touch-pan-y rounded-lg outline-none focus-visible:ring-2", tone.ring)}
          />
        </div>
      </div>
    </section>
  )
}

/**
 * "Growth Trends Chart" from the Keitoto library: three panels on a grey card, one per metric (revenue, profit and
 * expenses in Figma), each with its heading and ↗ button, the month's change against the average of the six months
 * before it, a badge with the change on the month before and ten bars that fade from a solid cap. The panels share
 * their months: hover (or drag on touch) a bar in any panel and all three highlight that month and read it, and the
 * hovered panel shows the month's amount in a tooltip; a click keeps the month (again, or Escape, lets it go) and the
 * arrow keys step through the months. Animated with anime.js: the panels rise in one after another, the headlines and
 * badges count up, the bars grow from the baseline left to right; a new month counts every figure to it, flips a
 * badge's arrow when the change turns and slides the tooltip over, and new data grows or shrinks the bars.
 */
function GrowthTrendsChart({
  title = "Growth trends",
  months = sampleGrowthTrendsMonths,
  metrics = sampleGrowthTrendsMetrics,
  bars = 10,
  compareMonths = 6,
  index: indexProp,
  defaultIndex = null,
  onIndexChange,
  onMetricClick,
  thisMonthLabel = "This month",
  formatCompare = defaultCompare,
  formatMonth,
  locale = "en-US",
  currency = "USD",
  formatValue,
  className,
  ...props
}: GrowthTrendsChartProps) {
  const n = months.length
  const last = n - 1
  const first = Math.max(0, n - Math.max(1, Math.round(bars)))
  const [indexValue, setIndex] = useControllableState<number | null>({
    value: indexProp,
    defaultValue: defaultIndex,
    onChange: (next) => onIndexChange?.(next, next === null ? undefined : months[next]),
  })
  const selected = indexValue !== null && indexValue >= first && indexValue <= last ? Math.round(indexValue) : null
  const [hovered, setHovered] = React.useState<{ panel: number; month: number } | null>(null)
  const [focused, setFocused] = React.useState<number | null>(null)
  // The month the panels read: the hovered one, else the kept one, else (while a panel has keyboard focus) the latest.
  const active = hovered?.month ?? selected ?? (focused !== null && n ? last : null)
  const tipPanel = hovered?.panel ?? focused

  const names = React.useMemo(
    () => months.map((month) => (formatMonth ? formatMonth(month) : formatDay(month, { month: "short", year: "numeric" }, locale))),
    [months, formatMonth, locale],
  )
  const money = React.useCallback((value: number) => formatCurrency(value, { locale, currency }), [locale, currency])
  const whole = React.useCallback((value: number) => formatCurrency(value, { locale, currency, maximumFractionDigits: 0 }), [locale, currency])
  const growth = React.useCallback(
    (value: number) => formatPercent(value, { locale, signDisplay: "exceptZero", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [locale],
  )

  const root = React.useRef<HTMLDivElement>(null)
  const all = (selector: string, within?: Element) => Array.from((within ?? root.current)?.querySelectorAll<HTMLElement>(selector) ?? [])

  // Entrance, once the card is in view: the panels rise in one after another; in each the heading and the button come
  // in, the headline counts up from zero, the badge pops with its amount counting and the captions fade in, while the
  // bars grow from the baseline left to right, each cap riding up on its bar.
  useChartEntrance(root, (timeline) => {
    const panels = all('[data-slot="growth-trends-chart-panel"]')
    const counted = all('[data-slot="growth-trends-chart-headline"][data-value], [data-slot="growth-trends-chart-change"]')
    const formatOf = (el: HTMLElement) => {
      if (el.dataset.slot === "growth-trends-chart-headline") return growth
      const metric = metrics[panels.findIndex(panel => panel.contains(el))]
      return formatValue && metric ? (value: number) => formatValue(value, metric) : whole
    }
    const counter = { t: 0 }
    const count = () => counted.forEach((el) => (el.textContent = formatOf(el)(Number(el.dataset.value) * counter.t)))
    count()
    timeline.add(panels, { opacity: { from: 0 }, translateY: { from: 16 }, duration: 800, ease: "outExpo", delay: stagger(PANEL_STAGGER) }, 0)
    timeline.add(counter, { t: [0, 1], duration: 1400, ease: "outExpo", onUpdate: count }, 200)
    const grown: { bar: HTMLElement; state: { t: number } }[] = []
    panels.forEach((panel, p) => {
      const at = p * PANEL_STAGGER
      timeline
        .add(all('[data-slot="growth-trends-chart-heading"]', panel), { opacity: { from: 0 }, translateX: { from: -6 }, duration: 600, ease: "outQuad" }, at + 120)
        .add(all('[data-slot="chart-button"]', panel), { opacity: { from: 0 }, scale: { from: 0.8 }, duration: 600, ease: "outBack(1.7)" }, at + 160)
        .add(all('[data-slot="growth-trends-chart-note"]', panel), { opacity: { from: 0 }, translateY: { from: 4 }, duration: 500, ease: "outQuad", delay: stagger(140) }, at + 260)
        .add(all('[data-slot="growth-trends-chart-badge"]', panel), { opacity: { from: 0 }, scale: { from: 0.85 }, duration: 600, ease: "outBack(1.7)" }, at + 320)
        .add(all('[data-slot="growth-trends-chart-badge-icon"]', panel), { rotate: { from: -90 }, duration: 700, ease: "outBack(1.6)" }, at + 360)
      all(BAR, panel).forEach((bar, i) => {
        const state = { t: 0 }
        grown.push({ bar, state })
        const draw = () => {
          bar.dataset.grow = String(state.t)
          drawBar(bar, Number(bar.dataset.h) * state.t)
        }
        draw()
        timeline.add(
          state,
          {
            t: [0, 1],
            duration: GROW,
            ease: "outExpo",
            onUpdate: draw,
            onComplete: () => {
              delete bar.dataset.grow
              drawBar(bar, Number(bar.dataset.h))
            },
          },
          at + BARS_AT + i * BAR_STAGGER,
        )
      })
    })
    return () => {
      grown.forEach(({ bar }) => {
        delete bar.dataset.grow
        drawBar(bar, Number(bar.dataset.h))
      })
      counter.t = 1
      count()
    }
  })

  const select = (month: number) => setIndex(selected === month ? null : month)
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (selected !== null) setIndex(null)
      return
    }
    const at = selected ?? last
    const page = Math.max(1, Math.round((last - first + 1) / 4))
    const next = { ArrowRight: at + 1, ArrowUp: at + 1, ArrowLeft: at - 1, ArrowDown: at - 1, PageUp: at + page, PageDown: at - page, Home: first, End: last }[event.key]
    if (next === undefined || !n) return
    event.preventDefault()
    setHovered(null)
    setIndex(Math.min(Math.max(next, first), last))
  }

  return (
    <ChartCard ref={root} role="group" aria-label={title} className={cn("w-full gap-1.5 bg-surface-disable", className)} {...props}>
      {metrics.map((metric, p) => (
        <Panel
          key={metric.id}
          metric={metric}
          color={metric.color ?? PALETTE[p % PALETTE.length]}
          names={names}
          first={first}
          active={active}
          tip={tipPanel === p}
          compareMonths={compareMonths}
          thisMonthLabel={thisMonthLabel}
          formatCompare={formatCompare}
          money={value => formatValue ? formatValue(value,metric) : money(value)}
          whole={value => formatValue ? formatValue(value,metric) : whole(value)}
          growth={growth}
          onHover={(month) => setHovered(current => month === null ? (current === null ? current : null) : current?.panel === p && current.month === month ? current : { panel: p, month })}
          onSelect={select}
          onKeyDown={onKeyDown}
          onFocusChange={(on) => setFocused((current) => (on ? p : current === p ? null : current))}
          onOpen={onMetricClick ? () => onMetricClick(metric) : undefined}
        />
      ))}
    </ChartCard>
  )
}

export {
  GrowthTrendsChart,
  sampleGrowthTrendsMetrics,
  sampleGrowthTrendsMonths,
  type GrowthTrendsChartProps,
  type GrowthTrendsColor,
  type GrowthTrendsMetric,
}
