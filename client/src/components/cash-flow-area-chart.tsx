"use client"

import { animate, stagger, svg, utils, type JSAnimation } from "animejs"
import * as React from "react"

import { ChartButton } from "@/components/ui/chart-button"
import { ChartCard } from "@/components/ui/chart-card"
import { ArrowCircleDownIcon, ArrowCircleUpIcon, BarLineChartIcon, DotsHorizontalIcon } from "@/components/ui/chart-icons"
import { ChartSwatch } from "@/components/ui/chart-swatch"
import { releaseStyles, useChartEntrance, useCountUp, useIsomorphicLayoutEffect, useReducedMotion } from "@/hooks/use-chart-motion"
import { useChartSize } from "@/hooks/use-chart-size"
import { useControllableState } from "@/hooks/use-controllable-state"
import { formatCompactCurrency, formatCurrency, formatDay } from "@/lib/chart-format"
import { alignPolylines, areaPath, fittedDash, linePath, niceTicks, reachAt, valueAt, xAtLength } from "@/lib/chart-series"
import { cn } from "@/lib/utils"
import { relativeChange } from "@/lib/metric-change"

type CashFlowPoint = {
  /** The day, as an ISO date ("2025-04-17"). */
  date: string
  value: number
}

type CashFlowAreaChartProps = Omit<React.ComponentProps<"div">, "children"> & {
  formatValue?: (value: number) => string
  formatChangeValue?: (value: number) => string
  title?: string
  /** The soft line under the title. */
  description?: string
  /** The glyph before the title (20px, drawn blue). */
  icon?: React.ReactNode
  /** The label over the total. */
  totalLabel?: string
  total?: number
  /** The label over the change. */
  changeLabel?: string
  /** An amount, shown signed and coloured by its sign ("+$2,456.00" in green, "-$310.00" in red). */
  change?: number
  /** The blue line and its area, oldest first; the points are spaced evenly across the plot. */
  data?: CashFlowPoint[]
  /** The grey comparison line, spread over the same width (it may have more or fewer points than `data`). */
  compare?: number[]
  /** First data index covered by a contiguous comparison suffix. */
  compareStartIndex?: number
  /** The comparison's name in the tooltip. */
  compareLabel?: string
  /** The y-axis values, lowest first. Round values around the data by default (5 of them). */
  ticks?: number[]
  /** The selected point (an index into `data`). */
  index?: number
  defaultIndex?: number
  onIndexChange?: (index: number, point: CashFlowPoint) => void
  /** Text for a point's date on the axis ("Apr") and in the tooltip ("April"). */
  formatDate?: (date: string, context: "axis" | "tooltip") => string
  /** Called by the ⋯ button. */
  onMoreClick?: () => void
  locale?: string
  currency?: string
}

// Figma geometry ("Cash Flow Area Chart" 1473:76243)
const PLOT_WIDTH = 594
const PLOT_HEIGHT = 260
const INSET = 12 // the first and last points sit 12px in from the sides of the plot, on the outer grid lines
const GRID_COLUMNS = 12 // 13 dashed lines, 47.5px apart at Figma's width
const TICK_TOP = 7 // the highest tick's value is level with the centre of its label…
const TICK_BOTTOM = PLOT_HEIGHT - 15 // …and the lowest one's too, 15px above the axis (the labels stop 8px above it)
const AREA_OFFSET = 1 // the fill starts 1px under the line…
const FADE_END = PLOT_HEIGHT - 40 // …and fades out 40px above the axis
const CAP = 5 // the cursor's filled triangle caps: 5px long, equilateral
const CAP_HALF = CAP / Math.sqrt(3)
const MARKER = 12
const TIP_GAP = 12 // between the cursor and the tooltip
const TIP_ROW = 18 // the tooltip's first row is level with the higher marker (8px padding + half the 20px row)
const TIP_PADDING_X = 24 // the tooltip's 12px side padding, twice
const TIP_PADDING_Y = 16 // and its 8px top and bottom padding
const LABEL_GAP = 8 // an end label of the x axis hides when the active label comes closer than this
const DRAW_AT = 350
const DRAW_DURATION = 1400
const RIDE = 450
const GRID_DASH = fittedDash(PLOT_HEIGHT) // 4/4 fitted to the 260px line: half a dash at each end
const CURSOR_DASH = fittedDash(PLOT_HEIGHT - 2 * CAP + 1) // 4/4 fitted between the caps (251px)
// Figma's markers have a 2px inside stroke with an angular gradient, starting at 6 o'clock
const MARKER_RING =
  "bg-[conic-gradient(from_180deg,#fafafa_0deg,#fafafa_41.33deg,#e3e3e3_64.88deg,#fafafa_97.81deg,#fafafa_222.22deg,#e3e3e3_254.91deg,#fafafa_285.04deg,#fafafa_360deg)]"

const DAY = 86_400_000

/** One point per value on evenly spaced days from `start` to `end` (ISO dates). */
function evenlyDated(start: string, end: string, values: number[]): CashFlowPoint[] {
  const from = Date.parse(`${start}T00:00:00Z`)
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - from) / DAY)
  return values.map((value, i) => ({
    date: new Date(from + Math.round((i * days) / Math.max(1, values.length - 1)) * DAY).toISOString().slice(0, 10),
    value,
  }))
}

// The Figma card: 95 points from 1 January to 1 August 2025 with the middle one (17 April) selected, and a 68-point
// comparison line. The values put both lines where Figma draws them on the $5K–$25K axis they produce.
const sampleCashFlowData = evenlyDated("2025-01-01", "2025-08-01", [
  18319.33, 17076.42, 16400.51, 17263.28, 18056.65, 16440.02, 15763.04, 15810.02, 17893.28, 17232.32, 16922.66, 14827.65, 13619.98, 17120.2,
  17792.91, 16298, 17373.27, 16456.03, 15979.8, 15508.9, 15654.12, 17925.31, 17138.35, 17403.16, 17501.4, 17058.27, 18139.94, 17764.08,
  17521.69, 17766.21, 17221.64, 17424.52, 17712.82, 17682.93, 17010.22, 17807.86, 16905.57, 17366.86, 17096.71, 17957.35, 18233.9, 16625.81,
  16778.51, 16689.88, 17435.2, 16884.22, 17297.45, 16503.02, 16592.71, 15779.06, 15953.1, 15788.67, 17483.25, 17595.37, 16121.82, 17216.3,
  15611.41, 16957.9, 17335.89, 16844.71, 16815.88, 16604.46, 15559.09, 13237.72, 13784.42, 17531.3, 15785.46, 17071.08, 16290.53, 17151.17,
  16599.12, 15408.53, 15041.21, 15071.11, 15118.09, 15798.28, 14647.2, 16192.29, 14865.03, 15911.46, 16606.59, 13441.66, 12472.11, 12184.87,
  13091.43, 14008.66, 15136.25, 14078.07, 14375.98, 13978.76, 14728.35, 14185.91, 15807.89, 16182.68, 14438.98,
])
const sampleCashFlowCompare = [
  22402.08, 21138.08, 20705.93, 21428.45, 22919.63, 23319.33, 22427.7, 20459.96, 18186.47, 18808.22, 17050.58, 15217.78, 18379.49, 21322.55,
  20494.12, 19520.5, 19722.06, 20104.67, 19141.3, 16850.73, 16989.09, 17347.79, 15600.4, 18458.06, 19699.85, 19055.9, 16435.66, 17139.4,
  18157.43, 19488.05, 20077.34, 18136.94, 20555.61, 20350.64, 18756.98, 19315.53, 19337.73, 18613.5, 20149.08, 19744.26, 17756.03, 16674.8,
  18054.95, 19324.07, 16738, 15655.06, 15730.22, 19062.73, 18005.41, 17510.06, 14158.76, 12226.89, 17826.06, 18902.17, 16510.82, 18230.88,
  16763.62, 16001.8, 15248.53, 15480.83, 19113.97, 17855.1, 18278.71, 18435.85, 17726.99, 19457.3, 18856.05, 18468.31,
]

/**
 * Where everything sits at a plot width. The points (and the comparison's, on their own spacing) run from 12px in on
 * the left to 12px in on the right, like the outer grid lines; Figma strokes those 1px lines over [x, x + 1], so they
 * are drawn half a pixel right of x. Values are placed on the ticks' scale, its lowest tick 245px down, its highest 7px.
 */
function layoutChart(data: CashFlowPoint[], compare: number[], ticksProp: number[] | undefined, width: number, compareStartIndex = 0) {
  const values = data.map((point) => point.value)
  const all = [...values, ...compare]
  const ticks = ticksProp?.length ? [...ticksProp].sort((a, b) => a - b) : all.length ? niceTicks(Math.min(...all), Math.max(...all)) : niceTicks(0, 100)
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const y = (value: number) => (hi > lo ? TICK_BOTTOM - ((value - lo) / (hi - lo)) * (TICK_BOTTOM - TICK_TOP) : (TICK_TOP + TICK_BOTTOM) / 2)
  const spread = (count: number) => (i: number) => (count > 1 ? INSET + (i * (width - 2 * INSET)) / (count - 1) : width / 2)
  const at = spread(values.length)
  const atCompare = spread(compare.length)
  return {
    ticks,
    step: values.length > 1 ? (width - 2 * INSET) / (values.length - 1) : width,
    current: values.map((value, i) => ({ x: at(i), y: y(value) })),
    previous: compare.map((value, i) => ({ x: compareStartIndex ? at(compareStartIndex + i) : atCompare(i), y: y(value) })),
    grid: Array.from({ length: GRID_COLUMNS + 1 }, (_, i) => INSET + (i * (width - 2 * INSET)) / GRID_COLUMNS + 0.5),
  }
}

/** The comparison's value `t` (0–1) of the way along the plot, linear between its points. */
function valueAlong(values: number[], t: number) {
  if (!values.length) return undefined
  const at = Math.min(Math.max(t, 0), 1) * (values.length - 1)
  const i = Math.floor(at)
  const next = values[Math.min(i + 1, values.length - 1)]
  return values[i] + (next - values[i]) * (at - i)
}

type TooltipText = {
  value: string
  date: string
  compareValue?: string
  compareLabel?: string
  difference?: string
  relative?: string
  /** The point is below the comparison (red, arrow down). */
  down?: boolean
}

/** The tooltip's rows. Rendered twice: visible (its numbers count) and as an invisible copy that is measured. */
function TooltipRows({
  text,
  dividerWidth,
  valueRef,
  compareRef,
  differenceRef,
}: {
  text: TooltipText
  dividerWidth: number
  valueRef?: React.Ref<HTMLSpanElement>
  compareRef?: React.Ref<HTMLSpanElement>
  differenceRef?: React.Ref<HTMLSpanElement>
}) {
  const dash = fittedDash(dividerWidth, 3, 3)
  return (
    <>
      <span className="flex items-center gap-1.5">
        <ChartSwatch className="h-5 w-1 bg-primary-blue-500" />
        <span ref={valueRef} className="typo-label-03-medium hug-w text-fg-loud">
          {text.value}
        </span>
        <span className="typo-label-02-regular hug-w text-fg-soft">{text.date}</span>
      </span>
      {text.compareValue !== undefined && (
        <>
          <span className="flex items-center gap-1.5">
            <ChartSwatch className="h-5 w-1 bg-surface-subdued" />
            <span ref={compareRef} className="typo-label-03-medium hug-w text-fg-loud">
              {text.compareValue}
            </span>
            {text.compareLabel && <span className="typo-label-02-regular hug-w text-fg-soft">{text.compareLabel}</span>}
          </span>
          {/* Icon/Soft, dashed 3/3 and fitted to the width; drawn over the 1px above its spot, like Figma's line */}
          <svg aria-hidden width={dividerWidth} height={1} className="-mt-px block shrink-0 overflow-visible">
            <line x1={0} x2={dividerWidth} y1={0.5} y2={0.5} className="stroke-icon-soft" {...dash} />
          </svg>
          <span className={cn("flex items-center gap-1", text.down ? "text-error-500" : "text-primary-green-500")}>
            {text.down ? <ArrowCircleDownIcon className="shrink-0" /> : <ArrowCircleUpIcon className="shrink-0" />}
            <span ref={differenceRef} className="typo-label-02-medium hug-w">
              {text.difference}
            </span>
            <span className="typo-label-02-medium hug-w">{text.relative}</span>
          </span>
        </>
      )}
    </>
  )
}

/**
 * "Cash Flow Area Chart" from the Keitoto library: the total cash flow and last month's change side by side, and a
 * blue area line against a grey comparison line on a dashed grid. The selected point (17 April in Figma) gets a dashed
 * blue cursor with triangle caps, a marker on each line and a tooltip with both values and their difference; its date
 * and the nearest y tick turn blue. Hover (or drag on touch) scrubs through the points, click or the arrow keys select
 * one. Animated with anime.js: the grid draws down, both lines draw themselves with the area filling in behind the
 * blue one, the cursor grows and the markers pop in as the strokes reach them, then the tooltip pops; a new point makes
 * the cursor and the markers ride along the lines to it while every number counts, and new data morphs the lines.
 */
function CashFlowAreaChart({
  formatValue,
  formatChangeValue,
  title = "Cash Flow",
  description = "Track money moving in and out across all accounts",
  icon = <BarLineChartIcon />,
  totalLabel = "Total cash flow",
  total = 14345.09,
  changeLabel = "Last month",
  change = 2456,
  data = sampleCashFlowData,
  compare = sampleCashFlowCompare,
  compareStartIndex = 0,
  compareLabel = "Last month",
  ticks: ticksProp,
  index: indexProp,
  defaultIndex,
  onIndexChange,
  formatDate,
  onMoreClick,
  locale = "en-US",
  currency = "USD",
  className,
  ...props
}: CashFlowAreaChartProps) {
  const n = data.length
  const [indexValue, setIndex] = useControllableState({
    value: indexProp,
    defaultValue: defaultIndex ?? Math.max(0, Math.floor((n - 1) / 2)),
    onChange: (next: number) => {
      if (data[next]) onIndexChange?.(next, data[next])
    },
  })
  const [plotRef, plot] = useChartSize<HTMLDivElement>({ width: PLOT_WIDTH, height: PLOT_HEIGHT })
  const width = plot.width || PLOT_WIDTH
  const { ticks, step, current, previous, grid } = React.useMemo(() => layoutChart(data, compare, ticksProp, width, compareStartIndex), [data, compare, ticksProp, width, compareStartIndex])
  // Content keys: parents may pass new arrays on every render, so changes are detected by value.
  const dataKey = `${data.map((p) => `${p.date}=${p.value}`).join(";")}|${compare.join(";")}|${ticks.join(";")}`
  const ticksKey = ticks.join(";")

  const [hovered, setHovered] = React.useState<number | null>(null)
  const [keyboardActive, setKeyboardActive] = React.useState(false)
  const interactionVisible = hovered !== null || keyboardActive
  const compareAt = (i: number) => compareStartIndex ? i >= compareStartIndex ? compare[i - compareStartIndex] : undefined : valueAlong(compare, n > 1 ? i / (n - 1) : 0.5)
  const selected = n ? Math.min(Math.max(Math.round(indexValue), 0), n - 1) : -1
  const active = hovered !== null && hovered < n ? hovered : selected
  const point = data[active]
  const cursorX = current[active]?.x ?? width / 2
  const compareValue = point ? compareAt(active) : undefined
  const difference = point && compareValue !== undefined ? point.value - compareValue : undefined
  const currentY = current[active]?.y ?? 0
  const compareY = compareValue !== undefined && previous.length ? valueAt(previous, cursorX) : undefined
  const activeTick = point ? ticks.reduce((best, tick) => (Math.abs(tick - point.value) < Math.abs(best - point.value) ? tick : best), ticks[0]) : undefined

  const money = React.useCallback((value: number) => formatValue ? formatValue(value) : formatCurrency(value, { locale, currency, maximumFractionDigits: 0 }), [locale, currency, formatValue])
  const differenceFormat = React.useCallback((value: number) => formatChangeValue ? formatChangeValue(value).replace(/^[+−-]/, "") : money(value), [formatChangeValue, money])
  const signedMoney = React.useCallback((value: number) => formatChangeValue ? formatChangeValue(value) : formatValue ? `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatValue(Math.abs(value))}` : formatCurrency(value, { locale, currency, signDisplay: "exceptZero", maximumFractionDigits: 0 }), [locale, currency, formatValue, formatChangeValue])
  const dateText = (date: string, context: "axis" | "tooltip") =>
    formatDate ? formatDate(date, context) : formatDay(date, { month: context === "axis" ? "short" : "long" }, locale)

  const tooltip: TooltipText | undefined = point
    ? {
        value: money(point.value),
        date: dateText(point.date, "tooltip"),
        compareValue: compareValue !== undefined ? money(compareValue) : undefined,
        compareLabel,
        difference: difference !== undefined ? differenceFormat(Math.abs(difference)) : undefined,
        relative: compareValue !== undefined ? (() => {
          const rate = relativeChange(point.value, compareValue)
          return rate === null ? "(—)" : `(${rate > 0 ? "+" : rate < 0 ? "−" : ""}${(Math.abs(rate) * 100).toFixed(1)}%)`
        })() : undefined,
        down: difference !== undefined && difference < 0,
      }
    : undefined

  // The tooltip sits right of the cursor, or left of it when it would run past the plot, with its first row level with
  // the higher marker. Its size is measured on an invisible copy that holds the final text.
  const [sizerRef, sizer] = useChartSize<HTMLSpanElement>({ width: 159, height: 78 })
  const tipWidth = sizer.width + TIP_PADDING_X
  const tipHeight = sizer.height + TIP_PADDING_Y
  const flipped = cursorX + TIP_GAP + tipWidth > width
  const preferredLeft = flipped ? cursorX - TIP_GAP - tipWidth : cursorX + TIP_GAP
  const boundedLeft = Math.max(0, Math.min(preferredLeft, width - tipWidth))
  const tipAnchor = boundedLeft + (flipped ? tipWidth : 0)
  const highest = Math.min(currentY, compareY ?? currentY)
  const tipTop = Math.round(Math.min(Math.max(highest - TIP_ROW, 0), Math.max(0, PLOT_HEIGHT - tipHeight)))
  const fillTop = Math.min(...current.map((p) => p.y), PLOT_HEIGHT) + AREA_OFFSET

  const reduced = useReducedMotion()
  const root = React.useRef<HTMLDivElement>(null)
  const totalRef = React.useRef<HTMLParagraphElement>(null)
  const changeRef = React.useRef<HTMLParagraphElement>(null)
  const lineRef = React.useRef<SVGPathElement>(null)
  const areaRef = React.useRef<SVGPathElement>(null)
  const compareRef = React.useRef<SVGPathElement>(null)
  const fillRef = React.useRef<SVGLinearGradientElement>(null)
  const wipeRef = React.useRef<SVGRectElement>(null)
  const cursorRef = React.useRef<SVGGElement>(null)
  const activeLabelRef = React.useRef<HTMLSpanElement>(null)
  const tipRef = React.useRef<HTMLDivElement>(null)
  const tipValueRef = React.useRef<HTMLSpanElement>(null)
  const tipCompareRef = React.useRef<HTMLSpanElement>(null)
  const tipDifferenceRef = React.useRef<HTMLSpanElement>(null)
  const ids = React.useId().replace(/[^\w-]/g, "")
  const totalText = money(total)
  const changeText = signedMoney(change)
  // what the entrance's callbacks need at play time (the card may be resized before it scrolls into view)
  const latest = React.useRef({ totalText, changeText, current })
  useIsomorphicLayoutEffect(() => {
    latest.current = { totalText, changeText, current }
  })
  const all = (selector: string) => Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])

  // New values count from the previous ones.
  useCountUp(totalRef, total, money, { duration: 900 })
  useCountUp(changeRef, change, signedMoney, { duration: 900 })
  useCountUp(tipValueRef, point?.value ?? 0, money, { duration: 400 })
  useCountUp(tipCompareRef, compareValue ?? 0, money, { duration: 400 })
  useCountUp(tipDifferenceRef, Math.abs(difference ?? 0), differenceFormat, { duration: 400 })

  // Entrance, once the card is in view: the totals count up, the divider, the axis and the grid lines grow, both lines
  // draw themselves left to right with the area filling in behind the blue one's tip, the cursor grows down to the
  // selected point, each marker pops in as its line reaches it, then the tooltip pops in.
  useChartEntrance(root, (timeline) => {
    const totalEl = totalRef.current
    const changeEl = changeRef.current
    const line = lineRef.current
    const grey = compareRef.current
    const wipe = wipeRef.current
    const cursor = cursorRef.current
    const blueAt = DRAW_AT + reachAt(current, cursorX) * DRAW_DURATION
    const greyAt = previous.length ? DRAW_AT + reachAt(previous, cursorX) * DRAW_DURATION : blueAt
    const shownAt = Math.max(blueAt, greyAt)
    const counter = { total: 0, change: 0 }
    const count = () => {
      if (totalEl) totalEl.textContent = money(counter.total)
      if (changeEl) changeEl.textContent = signedMoney(counter.change)
    }
    count()
    timeline
      .add(counter, { total: [0, total], change: [0, change], duration: 1400, ease: "outExpo", onUpdate: count }, 0)
      .add(all('[data-slot="cash-flow-area-chart-divider"]'), { scaleY: { from: 0 }, duration: 800, ease: "outExpo" }, 150)
      .add(all('[data-slot="cash-flow-area-chart-axis"]'), { scaleX: { from: 0 }, duration: 900, ease: "outExpo" }, 100)
      .add(all('[data-slot="cash-flow-area-chart-grid-line"]'), { y2: { from: 0 }, duration: 800, ease: "outQuad", delay: stagger(35) }, 100)
      .add(all('[data-slot="cash-flow-area-chart-tick"]'), { opacity: { from: 0 }, translateX: { from: -4 }, duration: 600, ease: "outQuad", delay: stagger(45) }, 250)
      .add(all('[data-slot="cash-flow-area-chart-axis-label"] > span'), { opacity: { from: 0 }, translateY: { from: 4 }, duration: 600, ease: "outQuad", delay: stagger(60) }, 300)
    if (grey) timeline.add(svg.createDrawable(grey), { draw: ["0 0", "0 1"], duration: DRAW_DURATION, ease: "inOutSine" }, DRAW_AT)
    if (line) timeline.add(svg.createDrawable(line), { draw: ["0 0", "0 1"], duration: DRAW_DURATION, ease: "inOutSine" }, DRAW_AT)
    if (wipe) {
      // the area's clip follows the blue stroke's tip
      const drawn = { f: 0 }
      wipe.setAttribute("width", "0")
      timeline.add(
        drawn,
        {
          f: [0, 1],
          duration: DRAW_DURATION,
          ease: "inOutSine",
          onUpdate: () => {
            const line = latest.current.current
            wipe.setAttribute("width", String(xAtLength(line, drawn.f)))
          },
          onComplete: () => wipe.setAttribute("width", "100%"),
        },
        DRAW_AT,
      )
    }
    if (cursor) {
      timeline
        .add(cursor.querySelectorAll("line"), { y2: { from: CAP - 0.5 }, duration: 600, ease: "outQuad" }, blueAt - 450)
        .add(cursor.querySelectorAll('[data-cap="start"]'), { scale: { from: 0 }, duration: 400, ease: "outBack(2.2)" }, blueAt - 500)
        .add(cursor.querySelectorAll('[data-cap="end"]'), { scale: { from: 0 }, duration: 400, ease: "outBack(2.2)" }, blueAt + 50)
    }
    for (const marker of all('[data-slot="cash-flow-area-chart-marker"]')) {
      const at = marker.dataset.series === "compare" ? greyAt : blueAt
      if (marker.firstElementChild) timeline.add(marker.firstElementChild, { scale: { from: 0 }, duration: 500, ease: "outBack(2.2)" }, Math.max(0, at - 100))
    }
    if (tipRef.current) timeline.add(tipRef.current, { opacity: { from: 0 }, translateY: { from: 6 }, scale: { from: 0.94 }, duration: 500, ease: "outBack(1.6)" }, shownAt + 50)
    return () => {
      // createDrawable leaves its dash attributes (revert sets them to "hidden"): give the plain lines back
      for (const path of [line, grey]) for (const attribute of ["pathLength", "stroke-dasharray", "stroke-dashoffset"]) path?.removeAttribute(attribute)
      wipe?.setAttribute("width", "100%")
      if (totalEl) totalEl.textContent = latest.current.totalText
      if (changeEl) changeEl.textContent = latest.current.changeText
    }
  })

  // A new point sends the cursor, the markers and the active date riding along the lines to it (the markers follow
  // the polylines, not a straight path), and slides the tooltip over; when the tooltip changes sides it pops in again.
  const drawnX = React.useRef(cursorX)
  const ride = React.useRef<JSAnimation | null>(null)
  const lastSelection = React.useRef({ active, width, dataKey, tipAnchor, tipTop, flipped })
  useIsomorphicLayoutEffect(() => {
    const before = lastSelection.current
    lastSelection.current = { active, width, dataKey, tipAnchor, tipTop, flipped }
    const cursor = cursorRef.current
    const label = activeLabelRef.current
    const markers = all('[data-slot="cash-flow-area-chart-marker"]')
    const tip = tipRef.current
    const settle = () => {
      drawnX.current = cursorX
      cursor?.style.removeProperty("transform")
      label?.style.removeProperty("transform")
      for (const marker of markers) marker.style.removeProperty("transform")
    }
    if (reduced || before.width !== width) {
      ride.current?.cancel()
      settle()
      return
    }
    if (tip && (before.tipAnchor !== tipAnchor || before.tipTop !== tipTop || before.flipped !== flipped)) {
      if (before.flipped !== flipped) animate(tip, { opacity: [0, 1], scale: [0.94, 1], duration: 300, ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
      else
        animate(tip, {
          translateX: [before.tipAnchor - tipAnchor + utils.get(tip, "translateX", false), 0],
          translateY: [before.tipTop - tipTop + utils.get(tip, "translateY", false), 0],
          duration: RIDE,
          ease: "outExpo",
          onComplete: releaseStyles("transform"),
        })
    }
    // new data: the morph below moves the markers
    if (before.dataKey !== dataKey) {
      ride.current?.cancel()
      settle()
      return
    }
    const from = drawnX.current
    if (from === cursorX) return
    const state = { x: from }
    const paint = () => {
      drawnX.current = state.x
      const dx = state.x - cursorX
      if (cursor) cursor.style.transform = `translateX(${dx}px)`
      if (label) label.style.transform = `translateX(${dx}px)`
      for (const marker of markers) {
        const line = marker.dataset.series === "compare" ? previous : current
        marker.style.transform = `translate(${dx}px, ${valueAt(line, state.x) - valueAt(line, cursorX)}px)`
      }
    }
    ride.current?.cancel()
    paint()
    ride.current = animate(state, { x: cursorX, duration: RIDE, ease: "outExpo", onUpdate: paint, onComplete: settle })
  }, [active, width, dataKey, tipAnchor, tipTop, flipped, reduced])

  // New data morphs both lines and the area (each pair resampled on the same x positions) and the markers ride along;
  // a line that wasn't there fades in.
  const lastData = React.useRef({ key: dataKey, current, previous, fillTop })
  const morph = React.useRef<JSAnimation | null>(null)
  useIsomorphicLayoutEffect(() => {
    const before = lastData.current
    lastData.current = { key: dataKey, current, previous, fillTop }
    if (before.key === dataKey) return
    morph.current?.cancel()
    const line = lineRef.current
    const area = areaRef.current
    const grey = compareRef.current
    const fill = fillRef.current
    const dots = all('[data-slot="cash-flow-area-chart-marker"] > span')
    if (reduced) return
    const blue = before.current.length && current.length ? alignPolylines(before.current, current) : null
    const pair = before.previous.length && previous.length ? alignPolylines(before.previous, previous) : null
    const startY = { current: valueAt(before.current, cursorX), compare: valueAt(before.previous, cursorX) }
    const draw = (progress: number) => {
      if (blue) {
        const points = blue.xs.map((x, i) => ({ x, y: blue.from[i] + (blue.to[i] - blue.from[i]) * progress }))
        line?.setAttribute("d", linePath(points))
        area?.setAttribute("d", areaPath(points, PLOT_HEIGHT, AREA_OFFSET))
        fill?.setAttribute("y1", String(before.fillTop + (fillTop - before.fillTop) * progress))
      }
      if (pair) grey?.setAttribute("d", linePath(pair.xs.map((x, i) => ({ x, y: pair.from[i] + (pair.to[i] - pair.from[i]) * progress }))))
      for (const dot of dots) {
        const compareDot = (dot.parentElement as HTMLElement | null)?.dataset.series === "compare"
        if (compareDot ? !pair : !blue) continue
        const to = compareDot ? (compareY ?? 0) : currentY
        dot.style.translate = `0 ${((compareDot ? startY.compare : startY.current) - to) * (1 - progress)}px`
      }
    }
    const state = { t: 0 }
    draw(0)
    morph.current = animate(state, {
      t: 1,
      duration: 900,
      ease: "outExpo",
      onUpdate: () => draw(state.t),
      onComplete: () => {
        line?.setAttribute("d", linePath(current))
        area?.setAttribute("d", areaPath(current, PLOT_HEIGHT, AREA_OFFSET))
        fill?.setAttribute("y1", String(fillTop))
        grey?.setAttribute("d", linePath(previous))
        for (const dot of dots) dot.style.removeProperty("translate")
      },
    })
    const appeared = [!blue && line, !blue && area, !pair && grey].filter((el): el is SVGPathElement => !!el)
    if (appeared.length) animate(appeared, { opacity: [0, 1], duration: 500, ease: "outQuad", onComplete: releaseStyles("opacity") })
  }, [dataKey, width, reduced])
  React.useEffect(
    () => () => {
      ride.current?.cancel()
      morph.current?.cancel()
    },
    [],
  )

  // New ticks fade their labels in again.
  const lastTicks = React.useRef(ticksKey)
  useIsomorphicLayoutEffect(() => {
    const before = lastTicks.current
    lastTicks.current = ticksKey
    if (before === ticksKey || reduced) return
    animate(all('[data-slot="cash-flow-area-chart-tick"]'), { opacity: [0, 1], duration: 500, delay: stagger(35), ease: "outQuad", onComplete: releaseStyles("opacity") })
  }, [ticksKey, reduced])

  // The first and last dates of the x axis give way to the active one when it comes close or says the same.
  useIsomorphicLayoutEffect(() => {
    const labels = all('[data-slot="cash-flow-area-chart-axis-label"]')
    const activeLabel = labels.find((label) => label.dataset.role === "active")
    const span = (label: HTMLElement) => {
      const half = ((label.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0) / 2
      const x = Number(label.dataset.x)
      return [x - half, x + half]
    }
    for (const label of labels) {
      if (label === activeLabel) continue
      if (!activeLabel) {
        label.removeAttribute("data-covered")
        continue
      }
      const [left, right] = span(label)
      const [activeLeft, activeRight] = span(activeLabel)
      label.toggleAttribute("data-covered", label.textContent === activeLabel.textContent || (left < activeRight + LABEL_GAP && right > activeLeft - LABEL_GAP))
    }
  })

  const select = (next: number) => {
    if (!n) return
    setIndex(Math.min(Math.max(next, 0), n - 1))
  }
  const pointAt = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.currentTarget
    const box = target.getBoundingClientRect()
    // CSS zoom (the live demo scales wide demos down) scales the box but not the layout
    const zoom = box.width / (target.offsetWidth || box.width || 1) || 1
    const x = (event.clientX - box.left) / zoom
    return n > 1 ? Math.min(n - 1, Math.max(0, Math.round((x - INSET) / step))) : 0
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(1, Math.round((n - 1) / 10))
    const next = { ArrowRight: selected + 1, ArrowUp: selected + 1, ArrowLeft: selected - 1, ArrowDown: selected - 1, PageUp: selected + page, PageDown: selected - page, Home: 0, End: n - 1 }[event.key]
    if (next === undefined || !n) return
    event.preventDefault()
    setHovered(null)
    select(next)
  }

  const selectedPoint = data[selected]
  const selectedCompare = selectedPoint ? compareAt(selected) : undefined
  const valueText = selectedPoint
    ? `${dateText(selectedPoint.date, "tooltip")} (${selectedPoint.date}): ${money(selectedPoint.value)}${selectedCompare !== undefined ? `, ${compareLabel} ${money(selectedCompare)}` : ""}`
    : undefined
  const ends = n ? [0, n - 1].filter((i, k, list) => list.indexOf(i) === k) : []

  return (
    <ChartCard ref={root} role="group" aria-label={title} className={cn("w-full", className)} {...props}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex shrink-0 text-primary-blue-500 [&_svg]:size-5">{icon}</span>
            {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
            <p className="typo-label-04-medium -my-0.5 truncate py-0.5 text-fg-loud">{title}</p>
          </div>
          {description && <p className="typo-label-02-medium -my-0.5 truncate py-0.5 text-fg-soft">{description}</p>}
        </div>
        <ChartButton size="icon" aria-label="More options" onClick={onMoreClick}>
          <DotsHorizontalIcon />
        </ChartButton>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
          <p className="typo-label-02-medium hug-w text-fg-soft">{totalLabel}</p>
          <p ref={totalRef} className="typo-heading-03-semibold hug-w whitespace-nowrap text-fg-loud">
            {totalText}
          </p>
        </div>
        <span aria-hidden data-slot="cash-flow-area-chart-divider" className="h-[52px] w-px shrink-0 bg-border-soft" />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
          <p className="typo-label-02-medium hug-w text-fg-soft">{changeLabel}</p>
          <p ref={changeRef} className={cn("typo-heading-03-semibold hug-w whitespace-nowrap", change < 0 ? "text-error-500" : "text-primary-green-500")}>
            {changeText}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div ref={plotRef} data-slot="cash-flow-area-chart-plot" data-interacting={interactionVisible} className="relative min-w-0 flex-1" style={{ height: PLOT_HEIGHT }}>
            {/* Figma "Value Row": a 1px Background/Soft stroke along the bottom, under the grid */}
            <span aria-hidden data-slot="cash-flow-area-chart-axis" className="absolute inset-x-0 bottom-0 h-px origin-left bg-surface-soft" />

            <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
              <defs>
                {/* Primary/Blue/blue-500 at 24% under the line, fading out 40px above the axis */}
                <linearGradient ref={fillRef} id={`${ids}-fill`} gradientUnits="userSpaceOnUse" x1="0" y1={fillTop} x2="0" y2={Math.max(FADE_END, fillTop + 1)}>
                  <stop offset="0" style={{ stopColor: "var(--primary-blue-500)", stopOpacity: 0.24 }} />
                  <stop offset="1" style={{ stopColor: "var(--primary-blue-500)", stopOpacity: 0 }} />
                </linearGradient>
                <clipPath id={`${ids}-wipe`}>
                  <rect ref={wipeRef} x="0" y="0" width="100%" height={PLOT_HEIGHT} />
                </clipPath>
              </defs>
              {/* Figma "Grid Line": 1px Border/Soft over [x, x + 1], dashed 4/4 */}
              {grid.map((x, i) => (
                <line
                  key={i}
                  data-slot="cash-flow-area-chart-grid-line"
                  x1={x}
                  x2={x}
                  y1={0}
                  y2={PLOT_HEIGHT}
                  // the cursor takes the place of a grid line it sits on, as in Figma
                  className={cn("stroke-border-soft transition-opacity duration-200", point && Math.abs(x - 0.5 - cursorX) < 1 && "opacity-0")}
                  {...GRID_DASH}
                />
              ))}
              {point && (
                // the cursor: a 1px blue-500 line centred on the point, dashed 4/4 between two filled triangle caps
                <g ref={cursorRef} data-slot="cash-flow-area-chart-cursor" className="fill-primary-blue-500" style={{ visibility: interactionVisible ? undefined : "hidden" }}>
                  <line x1={cursorX} x2={cursorX} y1={CAP - 0.5} y2={PLOT_HEIGHT - CAP + 0.5} className="stroke-primary-blue-500" {...CURSOR_DASH} />
                  <polygon
                    data-cap="start"
                    points={`${cursorX - CAP_HALF},0 ${cursorX + CAP_HALF},0 ${cursorX + 0.5},${CAP} ${cursorX - 0.5},${CAP}`}
                    className="origin-top [transform-box:fill-box]"
                  />
                  <polygon
                    data-cap="end"
                    points={`${cursorX - CAP_HALF},${PLOT_HEIGHT} ${cursorX + CAP_HALF},${PLOT_HEIGHT} ${cursorX + 0.5},${PLOT_HEIGHT - CAP} ${cursorX - 0.5},${PLOT_HEIGHT - CAP}`}
                    className="origin-bottom [transform-box:fill-box]"
                  />
                </g>
              )}
              {previous.length > 0 && (
                <path ref={compareRef} data-slot="cash-flow-area-chart-compare" d={linePath(previous)} fill="none" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="stroke-surface-subdued" />
              )}
              {current.length > 0 && (
                <>
                  <path ref={areaRef} data-slot="cash-flow-area-chart-area" d={areaPath(current, PLOT_HEIGHT, AREA_OFFSET)} fill={`url(#${ids}-fill)`} clipPath={`url(#${ids}-wipe)`} />
                  <path ref={lineRef} data-slot="cash-flow-area-chart-line" d={linePath(current)} fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="stroke-primary-blue-500" />
                </>
              )}
            </svg>

            {point && interactionVisible && (
              <>
                <Marker series="current" x={cursorX} y={currentY} className="bg-[#2d7dff]" />
                {compareY !== undefined && <Marker series="compare" x={cursorX} y={compareY} className="bg-surface-subdued" />}
              </>
            )}

            <div
              role="slider"
              tabIndex={n ? 0 : -1}
              aria-label={title}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, n - 1)}
              aria-valuenow={Math.max(0, selected)}
              aria-valuetext={valueText}
              data-slot="cash-flow-area-chart-scrubber"
              onPointerMove={(event) => setHovered(pointAt(event))}
              onPointerLeave={() => setHovered(null)}
              onPointerUp={(event) => {
                if (event.button === 0) select(pointAt(event))
              }}
              onKeyDown={onKeyDown}
              onFocus={event => setKeyboardActive(event.currentTarget.matches(":focus-visible"))}
              onBlur={() => setKeyboardActive(false)}
              className="absolute inset-0 cursor-pointer touch-pan-y rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary-blue-500/40"
            />

            {tooltip && (
              <div
                ref={tipRef}
                aria-hidden
                data-slot="cash-flow-area-chart-tooltip"
                className={cn(
                  "pointer-events-none absolute flex flex-col items-start gap-2 overflow-hidden rounded-xl bg-surface-white px-3 py-2 whitespace-nowrap",
                  // Figma paints later effects on top; CSS paints the first shadow on top
                  "shadow-[0_0_0_1px_#ececec,0_2px_4px_rgb(0_0_0/0.06),0_4px_16px_rgb(0_0_0/0.08)]",
                  flipped && "-translate-x-full",
                )}
                style={{ top: tipTop, left: tipAnchor, visibility: interactionVisible ? undefined : "hidden", opacity: interactionVisible ? 1 : 0, transition: "opacity 120ms ease" }}
              >
                <TooltipRows text={tooltip} dividerWidth={sizer.width} valueRef={tipValueRef} compareRef={tipCompareRef} differenceRef={tipDifferenceRef} />
              </div>
            )}
            {/* the same rows with their final text, measured to place the tooltip (the visible ones change width while they count) */}
            {tooltip && (
              <span ref={sizerRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex flex-col items-start gap-2 whitespace-nowrap">
                <TooltipRows text={tooltip} dividerWidth={0} />
              </span>
            )}
          </div>

          {/* Figma "Y Axis Labels": 34px wide, 8px short of the axis, spread top to bottom, left-aligned. The column is as
              wide as the Regular labels; a wider Semibold highlight runs a pixel past it, so the plot never moves. */}
          <div aria-hidden className="hug-w flex min-w-[34px] shrink-0 flex-col justify-between self-stretch pb-2">
            {[...ticks].reverse().map((tick) => (
              <span key={tick} data-slot="cash-flow-area-chart-tick" className="relative flex">
                <span className="typo-label-02-regular invisible whitespace-nowrap">{formatValue ? formatValue(tick) : formatCompactCurrency(tick, { locale, currency })}</span>
                <span
                  className={cn(
                    "absolute top-0 left-0 whitespace-nowrap transition-colors duration-300",
                    interactionVisible && tick === activeTick ? "typo-label-02-semibold text-primary-blue-500" : "typo-label-02-regular text-fg-soft",
                  )}
                >
                  {formatValue ? formatValue(tick) : formatCompactCurrency(tick, { locale, currency })}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div aria-hidden className="relative h-3.5">
          {ends.map((i) => (
            <span
              key={`${i}-${data[i].date}`}
              data-slot="cash-flow-area-chart-axis-label"
              data-role="end"
              data-x={current[i].x}
              className="absolute top-0 transition-opacity duration-300 data-covered:opacity-0"
              style={{ left: current[i].x }}
            >
              <span className="typo-label-02-regular block -translate-x-1/2 whitespace-nowrap text-fg-soft">{dateText(data[i].date, "axis")}</span>
            </span>
          ))}
          {point && interactionVisible && (
            <span ref={activeLabelRef} data-slot="cash-flow-area-chart-axis-label" data-role="active" data-x={cursorX} className="absolute top-0" style={{ left: cursorX }}>
              <span className="typo-label-02-semibold block -translate-x-1/2 whitespace-nowrap text-primary-blue-500">{dateText(point.date, "axis")}</span>
            </span>
          )}
        </div>
      </div>
    </ChartCard>
  )
}

/** A 12px marker: the line's colour inside a 2px light ring (Figma's angular gradient) with two soft drop shadows. */
function Marker({ series, x, y, className }: { series: "current" | "compare"; x: number; y: number; className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="cash-flow-area-chart-marker"
      data-series={series}
      className="pointer-events-none absolute"
      style={{ left: x - MARKER / 2, top: y - MARKER / 2, width: MARKER, height: MARKER }}
    >
      <span className={cn("flex size-full rounded-full p-0.5 shadow-[0_1px_4px_rgb(0_0_0/0.06),0_2px_8px_rgb(0_0_0/0.12)]", MARKER_RING)}>
        <span className={cn("size-full rounded-full", className)} />
      </span>
    </span>
  )
}

export { CashFlowAreaChart, sampleCashFlowCompare, sampleCashFlowData, type CashFlowAreaChartProps, type CashFlowPoint }
