"use client"

import { animate, stagger, svg, utils, type JSAnimation } from "animejs"
import * as React from "react"

import { ChartCard } from "@/components/ui/chart-card"
import { ArrowCircleDownIcon, ArrowCircleUpIcon, InfoCircleLineIcon, SettingsIcon } from "@/components/ui/chart-icons"
import { ChartSegmentedControl } from "@/components/ui/chart-segmented-control"
import { ChartTooltipLabel, ChartTooltipValue } from "@/components/ui/chart-tooltip-lines"
import { releaseStyles, useChartEntrance, useCountUp, useIsomorphicLayoutEffect, useReducedMotion } from "@/hooks/use-chart-motion"
import { useChartSize } from "@/hooks/use-chart-size"
import { useControllableState } from "@/hooks/use-controllable-state"
import { formatCurrency, formatPercent } from "@/lib/chart-format"
import { alignPolylines, bridgeWalk, fittedDash, smoothCurveAt, smoothPath, xAtLength } from "@/lib/chart-series"
import { cn } from "@/lib/utils"

type FinanceOverviewPoint = {
  value: number
  /** The point's time in the tooltip ("Wed 2:41 PM"); the axis label under the point by default. */
  label?: string
}

/** One segment of the Week / Month / Year control and the line it shows. */
type FinanceOverviewPeriod = {
  value: string
  label: string
  /** The line, oldest first, spread evenly across the plot. The last point is the current value: the total. */
  points: FinanceOverviewPoint[]
  /** What the change is measured against (the previous period's close); the first point's value by default. */
  previous?: number
  /** The text under the percentage for this period ("Vs last week"); the card's `compareLabel` by default. */
  compareLabel?: string
  /** The labels under the plot, each centred in an equal column, with a dashed grid line over its centre. */
  axis: string[]
}

type FinanceOverviewAreaChartProps = Omit<React.ComponentProps<"div">, "children"> & {
  formatValue?: (value: number) => string
  summaryValue?: number
  plotHeight?: number
  title?: string
  /** The soft label before the two tags. */
  categoryLabel?: string
  /** The green tag: what the numbers cover. */
  category?: string
  /** The purple tag (the line's colour) and the label over the total. */
  metric?: string
  periods?: FinanceOverviewPeriod[]
  period?: string
  defaultPeriod?: string
  onPeriodChange?: (period: string) => void
  /** The text under the percentage (a period's own `compareLabel` wins). */
  compareLabel?: string
  /** Called by the settings button. */
  onSettingsClick?: () => void
  /** Called by the ⓘ button next to the metric. */
  onInfoClick?: () => void
  locale?: string
  currency?: string
}

type Point = { x: number; y: number }

// Figma geometry ("Finance Overview Area Chart" 1473:75992)
const PLOT_WIDTH = 400 // the chart is 400px wide, 8px short of the card's content on the right
const PLOT_HEIGHT = 210
const END_GAP = 9 // the line stops 9px short of the plot's right edge, so the end marker and its halo fit
const LINE_TOP = 47 // the line is fitted to the plot: its highest value 47px under the top…
const LINE_BOTTOM = 140.3385 // …and its lowest 69.66px above the bottom, so the area shows under it
const AREA_BOTTOM = 209.8385 // the area's gradient runs from LINE_TOP to here (the 1px axis covers the rest)
const MARKER = 8
const TIP_GAP = 12 // between the point and the tooltip
const TIP_PADDING_X = 24 // the tooltip's 12px side padding, twice
const TIP_PADDING_Y = 16 // and its 8px top and bottom padding
const GRID_DASH = fittedDash(PLOT_HEIGHT, 5, 5) // Figma "Grid Line": 5/5 over 210px, half a dash at each end
const GUIDE_DASH = fittedDash(PLOT_HEIGHT)
const RING = "focus-visible:ring-primary-purple-500/40" // the card's focus rings are purple, like its line
// The glass tile's rim, by angle clockwise from the top (seen from the tile's centre, a corner's arc spans about 54°):
// 60% white along the sides, 75% round the top-left and bottom-right corners, 5% round the other two
const GLASS_RIM = [
  "conic-gradient(rgb(255 255 255 / 0.6) 0deg 18deg, rgb(255 255 255 / 0.05) 27deg 62deg, rgb(255 255 255 / 0.6) 70deg 106deg",
  "rgb(255 255 255 / 0.75) 135deg, rgb(255 255 255 / 0.6) 164deg 198deg, rgb(255 255 255 / 0.05) 207deg 242deg",
  "rgb(255 255 255 / 0.6) 250deg 286deg, rgb(255 255 255 / 0.75) 315deg, rgb(255 255 255 / 0.6) 344deg)",
].join(", ")
const DRAW_AT = 400
const DRAW_DURATION = 1500
const MORPH = 900

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const DAY = 86_400_000

/** "2:41 PM" for a number of minutes after midnight (built by hand, so the server and every browser agree). */
function clock(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24
  return `${hour % 12 || 12}:${String(Math.floor(minutes % 60)).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`
}

const dateLabel = (time: number) => `${MONTHS[new Date(time).getUTCMonth()]} ${new Date(time).getUTCDate()}`

// The Figma line, Sunday to Saturday evening: the drawn curve read at each of its 80 points and three times between
// each two (317 values, one every 31 minutes), on a scale that puts the last at $23,563.01 and the first at $22,479.54
// (+4.82%). Drawn as a monotone curve, it stays within 0.14px of Figma's.
const WEEK = [
  22479.54, 22456.83, 22438.5, 22425.31, 22419.8, 22427.82, 22451.22, 22474.61, 22482.63, 22478.57, 22464.74, 22441.07, 22412.6, 22382.95, 22352.87,
  22324.88, 22301.36, 22282.09, 22267.79, 22260.19, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11,
  22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11,
  22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22258.11, 22264.85, 22289.63, 22336.57, 22400.24, 22474.85, 22546.62, 22592.84, 22607.25,
  22598.7, 22573.78, 22548.85, 22540.3, 22541.28, 22545.57, 22555.42, 22571.2, 22610.63, 22674.05, 22724.65, 22742.17, 22740.96, 22735.86, 22724.62,
  22707.15, 22678.2, 22640.97, 22613.4, 22604.16, 22605.02, 22608.65, 22616.58, 22628.88, 22646.73, 22667.28, 22681.8, 22686.55, 22684.71, 22678.15,
  22666.15, 22650.51, 22630.18, 22606.07, 22584.66, 22572.23, 22568.12, 22566.26, 22564.04, 22558.84, 22539.38, 22505.92, 22478.73, 22469.24,
  22486.97, 22538.66, 22604.97, 22649.48, 22669.06, 22682.72, 22695.98, 22714.36, 22741.26, 22769.92, 22789.45, 22795.72, 22788.76, 22768.43,
  22748.11, 22741.14, 22754.28, 22792.63, 22830.98, 22844.13, 22833.48, 22802.42, 22771.35, 22760.71, 22765.7, 22780.28, 22794.85, 22799.84,
  22786.96, 22749.38, 22711.79, 22698.91, 22711.89, 22754.04, 22820.8, 22892.54, 22959.46, 23022.43, 23076.19, 23116.03, 23145.17, 23166.16,
  23176.99, 23179.88, 23175.85, 23163.66, 23146.69, 23132.51, 23124.35, 23119.34, 23114.48, 23106.76, 23090.03, 23064.24, 23036.51, 23014.07,
  22997.59, 22985.32, 22978.78, 22976.99, 22988.31, 23024.64, 23081.04, 23139.72, 23189.17, 23232.2, 23272.2, 23312.74, 23353.82, 23387.08, 23406.11,
  23411.61, 23401.8, 23373.11, 23336.06, 23310.68, 23299.05, 23291.73, 23286.7, 23281.84, 23276.76, 23273.02, 23271.05, 23270.51, 23275.34, 23290.3,
  23312.1, 23332.31, 23346.96, 23358.35, 23368.28, 23378.66, 23388.62, 23397.6, 23407.95, 23421.91, 23442.94, 23467.16, 23484.28, 23489.89, 23487.65,
  23481.13, 23474.61, 23472.38, 23477.37, 23491.95, 23506.52, 23511.51, 23498.11, 23458.99, 23419.87, 23406.46, 23411.16, 23427.78, 23457.7,
  23496.07, 23536.86, 23572.3, 23593.68, 23600.09, 23591.02, 23564.55, 23538.09, 23529.02, 23532.57, 23542.93, 23553.28, 23556.83, 23556.04,
  23553.74, 23551.44, 23550.65, 23556.44, 23573.31, 23590.18, 23595.97, 23591.86, 23577.07, 23549.72, 23513.57, 23473.43, 23437.01, 23414.39,
  23407.49, 23411.02, 23423.96, 23448.46, 23481.65, 23520.05, 23556.37, 23579.52, 23586.7, 23581.21, 23562.27, 23529.32, 23488.86, 23448.04,
  23414.31, 23394.69, 23388.95, 23394.74, 23411.61, 23428.49, 23434.27, 23427.7, 23408.52, 23389.35, 23382.77, 23393.29, 23423.97, 23454.65,
  23465.17, 23462.41, 23454.35, 23446.3, 23443.54, 23451.82, 23475.98, 23500.14, 23508.42, 23508.64, 23508.89, 23508.13, 23505.33, 23490.89,
  23463.74, 23441.18, 23433.24, 23435.66, 23443.09, 23453.7, 23463.11, 23468.35, 23471.05, 23474.42, 23481.65, 23512.39, 23567.62, 23613.02,
  23628.92, 23623.14, 23606.27, 23589.39, 23583.61, 23590.97, 23612.45, 23633.92, 23641.28, 23627.48, 23587.21, 23546.95, 23533.14, 23535.9,
  23542.49, 23551.65, 23563.01,
]
// The week's times run in step with its day columns: the line ends END_GAP short of the plot, at Saturday 8:13 PM.
const WEEK_STEP = (7 * 24 * 60 * (PLOT_WIDTH - END_GAP)) / PLOT_WIDTH / (WEEK.length - 1)
const weekLabel = (i: number) => {
  const minutes = Math.round(i * WEEK_STEP)
  return `${WEEKDAYS[Math.floor(minutes / 1440)]} ${clock(minutes % 1440)}`
}
const MONTH_START = Date.UTC(2026, 9, 4) // the last four weeks: Sunday 4 to Saturday 31 October 2026, a point a day
const YEAR_START = Date.UTC(2025, 10, 1) // the last twelve months: 1 November 2025 to 31 October 2026, a point a week

// Week is the Figma card; Month (down 2.53%) and Year (up 24.36%) are generated (seeded, so they are the same on
// every render) and end at the same current value.
const sampleFinanceOverviewPeriods: FinanceOverviewPeriod[] = [
  { value: "week", label: "Week", points: WEEK.map((value, i) => ({ value, label: weekLabel(i) })), axis: WEEKDAYS },
  {
    value: "month",
    label: "Month",
    points: bridgeWalk(11, 28, 24175.41, 23563.01, 900).map((value, i) => ({ value, label: dateLabel(MONTH_START + i * DAY) })),
    axis: ["Week 1", "Week 2", "Week 3", "Week 4"],
  },
  {
    value: "year",
    label: "Year",
    points: bridgeWalk(1, 53, 18947.3, 23563.01, 2600).map((value, i) => ({ value, label: dateLabel(YEAR_START + i * 7 * DAY) })),
    axis: [...MONTHS.slice(10), ...MONTHS.slice(0, 10)],
  },
]

/**
 * Where everything sits at a plot width. The points are spread evenly from the plot's left edge to END_GAP short of
 * its right one, and fitted between LINE_TOP (the highest value) and LINE_BOTTOM (the lowest), as in Figma. Each
 * axis label gets an equal column, with its grid line over the column's centre.
 */
function layoutChart(points: FinanceOverviewPoint[], columns: number, width: number) {
  const values = points.map((point) => point.value)
  const max = values.length ? Math.max(...values) : 0
  const min = values.length ? Math.min(...values) : 0
  const span = Math.max(0, width - END_GAP)
  const step = values.length > 1 ? span / (values.length - 1) : 0
  const y = (value: number) => (max > min ? LINE_TOP + ((max - value) / (max - min)) * (LINE_BOTTOM - LINE_TOP) : (LINE_TOP + LINE_BOTTOM) / 2)
  return {
    line: values.map((value, i) => ({ x: values.length > 1 ? i * step : span, y: y(value) })),
    step,
    grid: Array.from({ length: columns }, (_, i) => ((i + 0.5) * width) / columns),
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000

/** The area under the line: the smooth line, then straight down to AREA_BOTTOM and back. */
function areaPath(line: Point[], bottom = AREA_BOTTOM) {
  if (!line.length) return ""
  return `${smoothPath(line)} L ${round(line[line.length - 1].x)} ${bottom} L ${round(line[0].x)} ${bottom} Z`
}

/**
 * "Finance Overview Area Chart" from the Keitoto library: a portfolio card on a purple glow. The header holds a
 * glass settings button, the tags name the category and the metric, the Week / Month / Year control picks the period,
 * and a purple area line shows the metric over it, ending in a dot at the current value. Under the chart: the total
 * (the line's last value), the change over the period and the percentage, green and up or red and down. Hover (or drag
 * on touch) scrubs the line with a tooltip; the arrow keys do the same. Animated with anime.js: the glow blooms and its
 * light streaks slide in, the tags pop, the grid draws down, the line draws itself with the area filling in behind its
 * tip, the dot pops and starts to pulse, and the numbers count up; a new period morphs the line and the area, the dot
 * rides to the new end and every number counts to its new value.
 */
function FinanceOverviewAreaChart({
  title = "Finance Overview",
  categoryLabel = "Metric Category",
  category = "All Investment",
  metric = "Total portfolio value",
  periods = sampleFinanceOverviewPeriods,
  period: periodProp,
  defaultPeriod,
  onPeriodChange,
  compareLabel = "Vs Previous period",
  onSettingsClick,
  onInfoClick,
  locale = "en-US",
  currency = "USD",
  formatValue,
  summaryValue,
  plotHeight = PLOT_HEIGHT,
  className,
  ...props
}: FinanceOverviewAreaChartProps) {
  const [periodValue, setPeriod] = useControllableState({ value: periodProp, defaultValue: defaultPeriod ?? periods[0]?.value ?? "", onChange: onPeriodChange })
  const period = periods.find((option) => option.value === periodValue) ?? periods[0]
  const points = React.useMemo(() => period?.points ?? [], [period])
  const axis = React.useMemo(() => period?.axis ?? [], [period])
  const n = points.length
  const [plotRef, plot] = useChartSize<HTMLDivElement>({ width: PLOT_WIDTH, height: plotHeight })
  const width = plot.width || PLOT_WIDTH
  const { line, step, grid } = React.useMemo(() => {
    const layout = layoutChart(points, axis.length, width)
    return { ...layout, line: layout.line.map(point => ({ ...point, y: point.y * plotHeight / PLOT_HEIGHT })) }
  }, [points, axis.length, width, plotHeight])
  const areaBottom = AREA_BOTTOM * plotHeight / PLOT_HEIGHT
  // Content keys: parents may pass new arrays on every render, so changes are detected by value.
  const dataKey = `${period?.value}|${points.map((point) => point.value).join(";")}`
  const axisKey = `${period?.value}|${axis.join(";")}`

  const total = summaryValue ?? points[n - 1]?.value ?? 0
  const base = period?.previous ?? points[0]?.value ?? 0
  const change = n ? total - base : 0
  const percent = base ? (change / Math.abs(base)) * 100 : 0
  const down = change < 0

  const [hovered, setHovered] = React.useState<number | null>(null)
  const hover = hovered !== null && hovered < n ? hovered : null
  const active = hover ?? n - 1
  const activeAt = line[active]
  const columnOf = (x: number) => (axis.length ? axis[Math.min(axis.length - 1, Math.max(0, Math.floor((x / width) * axis.length)))] : "")
  const labelOf = (i: number) => points[i]?.label ?? columnOf(line[i]?.x ?? 0)

  const money = React.useCallback((value: number) => formatValue ? formatValue(value) : formatCurrency(value, { locale, currency }), [locale, currency, formatValue])
  const signedMoney = React.useCallback((value: number) => formatValue ? `${value >= 0 ? "+" : "−"}${formatValue(Math.abs(value))}` : formatCurrency(value, { locale, currency, signDisplay: "exceptZero" }), [locale, currency, formatValue])
  const percentText = React.useCallback((value: number) => `${down ? "−" : "+"}${formatPercent(Math.abs(value), { locale })}`, [locale, down])
  const tooltip = hover !== null ? { value: money(points[hover].value), label: labelOf(hover) } : undefined

  // The tooltip sits centred over the point, 12px above it (below when there's no room), inside the plot. Its size is
  // measured on an invisible copy that holds the same text.
  const [sizerRef, sizer] = useChartSize<HTMLSpanElement>({ width: 150, height: 16 })
  const tipWidth = sizer.width + TIP_PADDING_X
  const tipHeight = sizer.height + TIP_PADDING_Y
  const tipLeft = activeAt ? Math.round(Math.min(Math.max(activeAt.x - tipWidth / 2, 0), Math.max(0, width - tipWidth))) : 0
  const tipTop = activeAt ? Math.round(activeAt.y - TIP_GAP - tipHeight >= 0 ? activeAt.y - TIP_GAP - tipHeight : activeAt.y + TIP_GAP) : 0

  const reduced = useReducedMotion()
  const root = React.useRef<HTMLDivElement>(null)
  const lineRef = React.useRef<SVGPathElement>(null)
  const areaRef = React.useRef<SVGPathElement>(null)
  const wipeRef = React.useRef<SVGRectElement>(null)
  const guideRef = React.useRef<SVGLineElement>(null)
  const markerRef = React.useRef<HTMLSpanElement>(null)
  const pulseRef = React.useRef<HTMLSpanElement>(null)
  const tipRef = React.useRef<HTMLDivElement>(null)
  const totalRef = React.useRef<HTMLParagraphElement>(null)
  const changeRef = React.useRef<HTMLParagraphElement>(null)
  const percentRef = React.useRef<HTMLParagraphElement>(null)
  const arrowRef = React.useRef<HTMLSpanElement>(null)
  const ids = React.useId().replace(/[^\w-]/g, "")
  const totalText = money(total)
  const changeText = signedMoney(change)
  const percentLabel = percentText(percent)
  // what the animations' callbacks need when they run (the card may be resized before it scrolls into view, and the
  // line may be scrubbed while it morphs)
  const latest = React.useRef({ totalText, changeText, percentLabel, line, hover })
  useIsomorphicLayoutEffect(() => {
    latest.current = { totalText, changeText, percentLabel, line, hover }
  })
  const all = (selector: string) => Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])

  // New values count from the previous ones.
  useCountUp(totalRef, total, money, { duration: 900 })
  useCountUp(changeRef, change, signedMoney, { duration: 900 })
  useCountUp(percentRef, Math.abs(percent), percentText, { duration: 900 })

  // The dot at the current value pulses once the card has come in, and rests while the line is scrubbed.
  const pulse = React.useRef<JSAnimation | null>(null)
  const startPulse = () => {
    const ring = pulseRef.current
    if (!ring || pulse.current) return
    pulse.current = animate(ring, { scale: [1, 2.8], opacity: [0.35, 0], duration: 1800, ease: "outQuad", loop: true, loopDelay: 700 })
  }
  React.useEffect(
    () => () => {
      pulse.current?.cancel()
      pulse.current = null
    },
    [],
  )
  useIsomorphicLayoutEffect(() => {
    if (!reduced) return
    pulse.current?.cancel()
    pulse.current = null
  }, [reduced])

  // Entrance, once the card is in view: the glow blooms and its streaks slide in, the header and the tags come in,
  // the grid draws down and the axis grows, the line draws itself with the area filling in behind its tip, the dot
  // pops in where the line ends and starts to pulse, and the total, the change and the percentage count up.
  useChartEntrance(root, (timeline) => {
    const path = lineRef.current
    const wipe = wipeRef.current
    const dot = markerRef.current?.firstElementChild
    const totalEl = totalRef.current
    const changeEl = changeRef.current
    const percentEl = percentRef.current
    const counters = { total: 0, change: 0, percent: 0 }
    const count = () => {
      if (totalEl) totalEl.textContent = money(counters.total)
      if (changeEl) changeEl.textContent = signedMoney(counters.change)
      if (percentEl) percentEl.textContent = percentText(counters.percent)
    }
    count()
    const endAt = DRAW_AT + DRAW_DURATION
    timeline
      .add(all("[data-glow]"), { opacity: { from: 0 }, scale: { from: 0.55 }, duration: 1800, ease: "outQuad", delay: stagger(150) }, 0)
      .add(all("[data-shine]"), { opacity: { from: 0 }, translateY: { from: -36 }, duration: 1400, ease: "outExpo", delay: stagger(110) }, 450)
      .add(all('[data-slot="finance-overview-area-chart-header"] > *'), { opacity: { from: 0 }, translateY: { from: 6 }, duration: 700, ease: "outExpo", delay: stagger(90) }, 50)
      .add(all('[data-slot="finance-overview-area-chart-tags"] > p, [data-slot="finance-overview-area-chart-tags"] > div > *'), { opacity: { from: 0 }, scale: { from: 0.85 }, duration: 550, ease: "outBack(1.7)", delay: stagger(80) }, 150)
      .add(all('[data-slot="chart-segmented-control"]'), { opacity: { from: 0 }, translateY: { from: 8 }, duration: 700, ease: "outExpo" }, 220)
      .add(all('[data-slot="finance-overview-area-chart-grid-line"]'), { y2: { from: 0 }, duration: 800, ease: "outQuad", delay: stagger(45) }, 280)
      .add(all('[data-slot="finance-overview-area-chart-axis"]'), { scaleX: { from: 0 }, duration: 900, ease: "outExpo" }, 280)
      .add(all('[data-slot="finance-overview-area-chart-axis-label"]'), { opacity: { from: 0 }, translateY: { from: 4 }, duration: 600, ease: "outQuad", delay: stagger(50) }, 380)
      .add(all('[data-slot="finance-overview-area-chart-stat"]'), { opacity: { from: 0 }, translateY: { from: 8 }, duration: 700, ease: "outExpo", delay: stagger(80) }, 400)
      .add(counters, { total: [0, total], change: [0, change], percent: [0, Math.abs(percent)], duration: 1600, ease: "outExpo", onUpdate: count }, 450)
    if (path) timeline.add(svg.createDrawable(path), { draw: ["0 0", "0 1"], duration: DRAW_DURATION, ease: "inOutSine" }, DRAW_AT)
    if (wipe) {
      // the area's clip follows the stroke's tip
      const drawn = { f: 0 }
      wipe.setAttribute("width", "0")
      timeline.add(
        drawn,
        {
          f: [0, 1],
          duration: DRAW_DURATION,
          ease: "inOutSine",
          onUpdate: () => {
            const current = latest.current.line
            wipe.setAttribute("width", String(xAtLength(current, drawn.f)))
          },
          onComplete: () => wipe.setAttribute("width", "100%"),
        },
        DRAW_AT,
      )
    }
    if (dot) timeline.add(dot, { scale: { from: 0 }, duration: 550, ease: "outBack(2.4)" }, endAt - 120)
    timeline.call(startPulse, endAt + 350)
    return () => {
      // createDrawable leaves its dash attributes (revert sets them to "hidden"): give the plain line back
      for (const attribute of ["pathLength", "stroke-dasharray", "stroke-dashoffset"]) path?.removeAttribute(attribute)
      wipe?.setAttribute("width", "100%")
      if (totalEl) totalEl.textContent = latest.current.totalText
      if (changeEl) changeEl.textContent = latest.current.changeText
      if (percentEl) percentEl.textContent = latest.current.percentLabel
    }
  })

  // Scrubbing follows the pointer directly; React positions the dot, guide and tooltip.

  // A new period morphs the line and the area (both lines sampled along their curves on the same x positions) and the
  // dot follows the line's end.
  const lastData = React.useRef({ key: dataKey, line, width })
  const morph = React.useRef<JSAnimation | null>(null)
  useIsomorphicLayoutEffect(() => {
    const before = lastData.current
    lastData.current = { key: dataKey, line, width }
    if (before.key === dataKey) return
    morph.current?.cancel()
    const lineEl = lineRef.current
    const areaEl = areaRef.current
    const [dot] = all('[data-slot="finance-overview-area-chart-marker"] > span')
    if (reduced || before.width !== width || !before.line.length || !line.length) return
    const aligned = alignPolylines(before.line, line, 48, smoothCurveAt)
    const endY = line[line.length - 1].y
    const draw = (t: number) => {
      const frame = aligned.xs.map((x, i) => ({ x, y: aligned.from[i] + (aligned.to[i] - aligned.from[i]) * t }))
      lineEl?.setAttribute("d", smoothPath(frame))
      areaEl?.setAttribute("d", areaPath(frame, areaBottom))
      // the dot rides on the line's end, unless a scrub has taken it elsewhere
      if (latest.current.hover === null) dot?.style.setProperty("translate", `0 ${frame[frame.length - 1].y - endY}px`)
      else dot?.style.removeProperty("translate")
    }
    const state = { t: 0 }
    draw(0)
    morph.current = animate(state, {
      t: 1,
      duration: MORPH,
      ease: "outExpo",
      onUpdate: () => draw(state.t),
      onComplete: () => {
        lineEl?.setAttribute("d", smoothPath(line))
        areaEl?.setAttribute("d", areaPath(line, areaBottom))
        dot?.style.removeProperty("translate")
      },
    })
  }, [dataKey, width, reduced, areaBottom])
  React.useEffect(
    () => () => {
      morph.current?.cancel()
    },
    [],
  )

  // New axis labels fade up; a different number of them draws the grid down again.
  const lastAxis = React.useRef({ axisKey, columns: axis.length })
  useIsomorphicLayoutEffect(() => {
    const before = lastAxis.current
    lastAxis.current = { axisKey, columns: axis.length }
    if (before.axisKey === axisKey || reduced) return
    animate(all('[data-slot="finance-overview-area-chart-axis-label"]'), {
      opacity: [0, 1],
      translateY: [4, 0],
      duration: 450,
      delay: stagger(35),
      ease: "outQuad",
      onComplete: releaseStyles("opacity", "transform"),
    })
    if (before.columns !== axis.length)
      animate(all('[data-slot="finance-overview-area-chart-grid-line"]'), { y2: [0, plotHeight], duration: 600, delay: stagger(30), ease: "outQuad" })
  }, [axisKey, axis.length, reduced])

  // The arrow turns over when the change flips sign.
  const lastDown = React.useRef(down)
  useIsomorphicLayoutEffect(() => {
    const before = lastDown.current
    lastDown.current = down
    if (before === down || reduced || !arrowRef.current) return
    animate(arrowRef.current, { rotate: [180, 0], scale: [0.7, 1], duration: 600, ease: "outBack(1.8)", onComplete: releaseStyles("transform") })
  }, [down, reduced])

  const changePeriod = (next: string) => {
    setHovered(null)
    setPeriod(next)
  }
  // Pointer positions in the plot's own pixels (the live demo may scale the card with CSS zoom).
  const pointAt = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.currentTarget
    const box = target.getBoundingClientRect()
    const zoom = box.width / (target.offsetWidth || box.width || 1) || 1
    const x = (event.clientX - box.left) / zoom
    return n > 1 ? Math.min(n - 1, Math.max(0, Math.round(x / step))) : 0
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!n) return
    if (event.key === "Escape") {
      setHovered(null)
      return
    }
    const at = hover ?? n - 1
    const page = Math.max(1, Math.round((n - 1) / 10))
    const next = { ArrowRight: at + 1, ArrowUp: at + 1, ArrowLeft: at - 1, ArrowDown: at - 1, PageUp: at + page, PageDown: at - page, Home: 0, End: n - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    setHovered(Math.min(Math.max(next, 0), n - 1))
  }

  return (
    <ChartCard ref={root} role="group" aria-label={title} className={cn("w-full gap-5", className)} {...props}>
      {/* Figma: two blurred circles (#8979ff and #d545ff at 80%, "layer blur 160") and five light streaks rotated 38.97°,
          white fading out, added with plus-lighter / lighten. Kept right-aligned, so wider cards keep the corner glow. */}
      <div aria-hidden data-slot="finance-overview-area-chart-glow" className="pointer-events-none absolute inset-0">
        <span data-glow="" className="absolute top-[-77px] right-[-90px] size-[208px] rounded-[50%] bg-[#8979ff]/80 blur-[72px]" />
        <span data-glow="" className="absolute top-[-77px] right-[27px] size-32 rounded-[50%] bg-[#d545ff]/80 blur-[72px]" />
        <span
          data-shine=""
          className="absolute top-[-32.756px] left-[calc(100%-26.453px)] h-[123.219px] w-[20.82px] origin-top-left rotate-[38.967deg] bg-linear-to-b from-white/6 to-white/0 mix-blend-plus-lighter blur-[1px]"
        />
        <span
          data-shine=""
          className="absolute top-[-62.418px] left-[calc(100%-25.18px)] h-[110.389px] w-[12.918px] origin-top-left rotate-[38.967deg] bg-linear-to-b from-white/40 to-white/0 mix-blend-lighten blur-[1px]"
        />
        <span
          data-shine=""
          className="absolute top-[-9px] left-[calc(100%+18.422px)] h-[110.389px] w-[13.985px] origin-top-left rotate-[38.967deg] bg-linear-to-b from-white/14 to-white/0 mix-blend-plus-lighter blur-[1px]"
        />
        <span
          data-shine=""
          className="absolute top-[-38.301px] left-[calc(100%+12.824px)] h-[96.719px] w-[17.057px] origin-top-left rotate-[38.967deg] bg-linear-to-b from-white/32 to-white/0 to-[83.7%] mix-blend-plus-lighter blur-[1px]"
        />
        <svg
          data-shine=""
          width="14.88"
          height="96.746"
          className="absolute top-[-46.135px] left-[calc(100%+20.031px)] origin-top-left rotate-[38.967deg] overflow-visible mix-blend-plus-lighter blur-[2px]"
        >
          <defs>
            <linearGradient id={`${ids}-shine`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity={0.4} />
              <stop offset="1" stopColor="#fff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d="M0 0H14.88L9.402 96.746L5.498 96.689Z" fill={`url(#${ids}-shine)`} />
        </svg>
      </div>

      <div data-slot="finance-overview-area-chart-header" className="relative flex items-center justify-between gap-4">
        {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
        <p className="typo-heading-01-semibold -my-0.5 min-w-0 truncate py-0.5 text-fg-loud">{title}</p>
        {/* Figma: white at 24% with the Glass effect (light from the top left), which CSS can't draw. Its rim is a 1px
            white ring measured from the render: 60% along the sides, 75% round the top-left and bottom-right corners,
            almost nothing round the other two. */}
        <button
          type="button"
          aria-label="Settings"
          onClick={onSettingsClick}
          className={cn(
            "relative flex size-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl bg-surface-white/24 text-surface-white outline-none",
            "transition-colors duration-200 hover:bg-surface-white/40 focus-visible:ring-2 [&_svg]:relative [&_svg]:size-4",
            "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:p-px before:[background:var(--glass-rim)]",
            "before:[mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)]",
            RING,
          )}
          style={{ "--glass-rim": GLASS_RIM } as React.CSSProperties}
        >
          <SettingsIcon />
        </button>
      </div>

      <div data-slot="finance-overview-area-chart-tags" className="relative flex items-center gap-3">
        <p className="typo-label-02-medium hug-w shrink-0 py-1 pr-2 whitespace-nowrap text-fg-soft">{categoryLabel}</p>
        {/* one row in Figma; a narrow card wraps the tags rather than cutting them off */}
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
          <span className="flex shrink-0 items-center rounded-full bg-primary-green-500/12 px-2.5 py-1.5">
            <span className="typo-label-02-medium hug-w whitespace-nowrap text-primary-green-500">{category}</span>
          </span>
          {/* Figma's purple text is #ad45ff, not a variable; the tag is the line's colour (purple-500) at 12% */}
          <span className="flex shrink-0 items-center rounded-full bg-primary-purple-500/12 px-2.5 py-1.5">
            <span className="typo-label-02-medium hug-w whitespace-nowrap text-[#ad45ff]">{metric}</span>
          </span>
        </div>
      </div>

      {periods.length > 0 && (
        <ChartSegmentedControl
          aria-label="Period"
          variant="rounded"
          value={period?.value}
          onValueChange={changePeriod}
          items={periods.map((option) => ({ value: option.value, label: option.label }))}
          className="relative [&_[data-slot=chart-segmented-control-item]]:focus-visible:ring-primary-purple-500/40"
        />
      )}

      <div className="relative mr-2 flex flex-col gap-4">
        <div ref={plotRef} data-slot="finance-overview-area-chart-plot" className="relative" style={{ height: plotHeight }}>
          <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
            <defs>
              {/* Primary/Purple/purple-500 to purple-100 (transparent) from the line's top down, at 32% */}
              <linearGradient id={`${ids}-fill`} gradientUnits="userSpaceOnUse" x1="0" y1={LINE_TOP * plotHeight / PLOT_HEIGHT} x2="0" y2={areaBottom}>
                <stop offset="0" style={{ stopColor: "var(--primary-purple-500)" }} />
                <stop offset="1" style={{ stopColor: "var(--primary-purple-100)", stopOpacity: 0 }} />
              </linearGradient>
              <clipPath id={`${ids}-wipe`}>
                <rect ref={wipeRef} x="0" y="0" width="100%" height={plotHeight} />
              </clipPath>
            </defs>
            {/* Figma "Grid Line": 1px #e0e0e0, centred on x, dashed 5/5 */}
            {grid.map((x, i) => (
              <line key={i} data-slot="finance-overview-area-chart-grid-line" x1={x} x2={x} y1={0} y2={plotHeight} className="stroke-[#e0e0e0]" {...GRID_DASH} />
            ))}
            {hover !== null && activeAt && (
              <line ref={guideRef} data-slot="finance-overview-area-chart-guide" x1={activeAt.x} x2={activeAt.x} y1={0} y2={plotHeight} className="stroke-primary-purple-500/50" {...GUIDE_DASH} />
            )}
            {line.length > 0 && (
              <>
                <path ref={areaRef} data-slot="finance-overview-area-chart-area" d={areaPath(line, areaBottom)} fill={`url(#${ids}-fill)`} fillOpacity={0.32} clipPath={`url(#${ids}-wipe)`} />
                <path ref={lineRef} data-slot="finance-overview-area-chart-line" d={smoothPath(line)} fill="none" strokeWidth={2} className="stroke-primary-purple-500" />
              </>
            )}
          </svg>
          {/* Figma "Plot Area": a 1px #e0e0e0 stroke along the bottom, over the area */}
          <span aria-hidden data-slot="finance-overview-area-chart-axis" className="absolute inset-x-0 bottom-0 h-px origin-left bg-[#e0e0e0]" />

          {activeAt && (
            <span
              ref={markerRef}
              aria-hidden
              data-slot="finance-overview-area-chart-marker"
              className="pointer-events-none absolute"
              style={{ left: activeAt.x - MARKER / 2, top: activeAt.y - MARKER / 2, width: MARKER, height: MARKER }}
            >
              <span className="relative block size-full">
                <span className={cn("absolute inset-0 transition-opacity duration-300", hover !== null && "opacity-0")}>
                  <span ref={pulseRef} className="absolute inset-0 rounded-full bg-primary-purple-500 opacity-0" />
                </span>
                {/* Figma: purple-500 inside a 1px white stroke, with a 1px #8979ff halo at 24% */}
                <span className="absolute inset-0 rounded-full border border-surface-white bg-primary-purple-500 shadow-[0_0_0_1px_rgb(137_121_255/0.24)]" />
              </span>
            </span>
          )}

          <div
            role="slider"
            tabIndex={n ? 0 : -1}
            aria-label={`${metric}, ${period?.label ?? ""}`}
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, n - 1)}
            aria-valuenow={Math.max(0, active)}
            aria-valuetext={n ? `${labelOf(active)}: ${money(points[active].value)}` : undefined}
            data-slot="finance-overview-area-chart-scrubber"
            onPointerMove={(event) => setHovered(pointAt(event))}
            onPointerDown={(event) => {
              // a tap or a drag across the plot reads the values on touch screens; the tooltip stays until the plot
              // loses focus (a tap elsewhere)
              if (event.pointerType !== "mouse") setHovered(pointAt(event))
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setHovered(null)
            }}
            onKeyDown={onKeyDown}
            onFocus={(event) => {
              if (event.currentTarget.matches(":focus-visible")) setHovered((at) => at ?? n - 1)
            }}
            onBlur={() => setHovered(null)}
            className={cn("absolute inset-0 touch-pan-y rounded-lg outline-none focus-visible:ring-2", RING)}
          />

          {tooltip && (
            <div
              ref={tipRef}
              aria-hidden
              data-slot="finance-overview-area-chart-tooltip"
              className={cn(
                "pointer-events-none absolute flex origin-bottom items-center gap-1.5 rounded-xl bg-surface-white px-3 py-2 whitespace-nowrap",
                // Figma paints later effects on top; CSS paints the first shadow on top
                "shadow-[0_0_0_1px_#ececec,0_2px_4px_rgb(0_0_0/0.06),0_4px_16px_rgb(0_0_0/0.08)]",
              )}
              style={{ left: tipLeft, top: tipTop }}
            >
              <ChartTooltipValue variant="light">{tooltip.value}</ChartTooltipValue>
              <ChartTooltipLabel variant="light">{tooltip.label}</ChartTooltipLabel>
            </div>
          )}
          {/* the same row, measured to place the tooltip */}
          {tooltip && (
            <span ref={sizerRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex items-center gap-1.5 whitespace-nowrap">
              <ChartTooltipValue variant="light">{tooltip.value}</ChartTooltipValue>
              <ChartTooltipLabel variant="light">{tooltip.label}</ChartTooltipLabel>
            </span>
          )}
        </div>

        {/* Figma "X Axis Labels": equal columns, centred */}
        <div aria-hidden className="flex">
          {axis.map((label, i) => (
            <span
              key={`${period?.value}-${i}`}
              data-slot="finance-overview-area-chart-axis-label"
              className="typo-label-02-medium min-w-0 flex-1 text-center whitespace-nowrap text-fg-soft"
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="relative flex items-end gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div data-slot="finance-overview-area-chart-stat" className="flex items-center gap-1">
            <p className="typo-label-03-medium hug-w whitespace-nowrap text-fg-soft">{metric}</p>
            <button
              type="button"
              aria-label={`About the ${metric.toLowerCase()}`}
              onClick={onInfoClick}
              className={cn(
                "relative size-4 shrink-0 cursor-pointer rounded-full text-icon-soft outline-none transition-colors duration-200 before:absolute before:-inset-2 hover:text-icon-normal focus-visible:ring-2",
                RING,
              )}
            >
              <InfoCircleLineIcon />
            </button>
          </div>
          <div className="flex flex-col items-start gap-2">
            <p ref={totalRef} data-slot="finance-overview-area-chart-stat" className="typo-heading-04-semibold hug-w whitespace-nowrap text-fg-loud">
              {totalText}
            </p>
            {/* the change and the percentage are green and up, or red and down (Error/error-50 and error-500) */}
            <p
              ref={changeRef}
              data-slot="finance-overview-area-chart-stat"
              className={cn(
                "typo-label-02-medium hug-w rounded-full px-2 py-1 whitespace-nowrap",
                down ? "bg-error-50 text-error-500" : "bg-primary-green-50 text-primary-green-500",
              )}
            >
              {changeText}
            </p>
          </div>
        </div>
        <div data-slot="finance-overview-area-chart-stat" className="flex shrink-0 flex-col items-end gap-1.5">
          <div className={cn("flex items-center gap-1", down ? "text-error-500" : "text-primary-green-500")}>
            <span ref={arrowRef} className="flex shrink-0">
              {down ? <ArrowCircleDownIcon className="size-5" /> : <ArrowCircleUpIcon className="size-5" />}
            </span>
            <p ref={percentRef} className="typo-heading-01-semibold hug-w whitespace-nowrap">
              {percentLabel}
            </p>
          </div>
          <p className="typo-label-01-medium hug-w whitespace-nowrap text-fg-soft">{period?.compareLabel ?? compareLabel}</p>
        </div>
      </div>
    </ChartCard>
  )
}

export {
  FinanceOverviewAreaChart,
  sampleFinanceOverviewPeriods,
  type FinanceOverviewAreaChartProps,
  type FinanceOverviewPeriod,
  type FinanceOverviewPoint,
}
