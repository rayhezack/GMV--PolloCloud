"use client"

import { animate, stagger, svg, utils, type JSAnimation } from "animejs"
import * as React from "react"

import { ChartButton } from "@/components/ui/chart-button"
import { ChartCard } from "@/components/ui/chart-card"
import { ArrowCircleDownIcon, ArrowCircleUpIcon, CreditCardIcon, DotsHorizontalIcon, FastFoodIcon, PiggyBankIcon, ShoppingBagIcon } from "@/components/ui/chart-icons"
import { ChartTrend } from "@/components/ui/chart-trend"
import { releaseStyles, useChartEntrance, useCountUp, useIsomorphicLayoutEffect, useReducedMotion } from "@/hooks/use-chart-motion"
import { useChartSize } from "@/hooks/use-chart-size"
import { useControllableState } from "@/hooks/use-controllable-state"
import { formatCompactCurrency, formatCurrency, formatTime } from "@/lib/chart-format"
import { alignPolylines, fittedDash, niceTicks, polylineLengths, reachAt, smoothPath, timeTicks, valueAt, xAtLength } from "@/lib/chart-series"
import { cn } from "@/lib/utils"

type CashBalancePoint = {
  /** ms since the epoch */
  time: number
  value: number
  /** A forecast: drawn like the rest of the line, called projected in the tooltip. Points after `now` are too. */
  projected?: boolean
}

type CashBalanceTone = "yellow" | "green" | "blue" | "purple" | "orange"

type CashBalanceTransaction = {
  id: string
  /** ms since the epoch */
  time: number
  label: string
  /** Money in is positive, money out negative ("-$24.50" in red). */
  amount: number
  /** The 14px glyph in the round tile, drawn white. */
  icon: React.ReactNode
  tone?: CashBalanceTone
}

/** A figure of the grey row at the bottom. */
type CashBalanceStat = {
  label: string
  value: number
}

type CashBalanceChartProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Embed only the plot and timeline inside an existing metric card. */
  chartOnly?: boolean
  plotHeight?: number
  /** Product actions have no transaction amount; keep the money tooltip factual. */
  eventTimeline?: boolean
  /** Locate an exact dated observation without highlighting the surrounding card. */
  focusTime?: number
  title?: string
  /** The glyph in the blue tile (14px, white). */
  icon?: React.ReactNode
  /** The label over the balance. */
  balanceLabel?: string
  /** The big figure; the line's value at `now` by default. */
  balance?: number
  /** Change of the balance in percent ("8.6" → ↗ 8.6% in green, negative values go down in red). */
  balanceChange?: number
  /** The figure next to the balance. */
  incomeLabel?: string
  income?: number
  incomeChange?: number
  /** Text after both changes ("vs Yesterday"). */
  changeLabel?: string
  /** The balance over the period, oldest first; points are placed by time. */
  data?: CashBalancePoint[]
  /** The target range [low, high], drawn as the hatched band. `null` for none. */
  range?: [number, number] | null
  /** The day's transactions: tiles on the timeline under the chart. */
  transactions?: CashBalanceTransaction[]
  /** The current time: the timeline fills up to it. The last point that isn't `projected` by default. */
  now?: number
  /** The period's ends (ms), the ends of both the chart and the timeline: the first and last points' times by default. */
  start?: number
  end?: number
  /** The y-axis values, lowest first. Four round values around the data and the range by default. */
  ticks?: number[]
  /** The figures in the grey row at the bottom. */
  summary?: CashBalanceStat[]
  /** The pinned point (an index into `data`), `null` for none: its cursor and tooltip stay when the pointer leaves. */
  index?: number | null
  defaultIndex?: number | null
  onIndexChange?: (index: number | null, point: CashBalancePoint | undefined) => void
  /** Called when a transaction's tile is clicked (it also pins its point). */
  onTransactionClick?: (transaction: CashBalanceTransaction) => void
  /** Text for a time on the timeline's axis ("6 AM") and in the tooltip ("9:34 AM"). Times are in UTC by default. */
  formatTime?: (time: number, context: "axis" | "tooltip") => string
  /** The text after the change in the tooltip; "since" and the first point's time ("since 6 AM") by default. */
  sinceLabel?: string
  /** The tooltip's word for points after `now`. */
  projectedLabel?: string
  /** The tooltip's word for transactions after `now`. */
  scheduledLabel?: string
  /** Called by the ⋯ button. */
  onMoreClick?: () => void
  locale?: string
  currency?: string
}

/** A point of the line (an index into `data`) and the transaction meant at it, if any. */
type Target = { index: number; id?: string }

// Figma geometry ("Cash Balance Chart" 1473:75804)
const PLOT_WIDTH = 354
const PLOT_HEIGHT = 200
const TRACK_WIDTH = 408
const GRID_TOP = 15.5 // the highest tick's grid line (Figma's 1px lines sit over [y - 1, y], so its centre is 15.5)…
const GRID_BOTTOM = 193.5 // …and the lowest one's; the ticks are spread evenly between them
const TICK_COUNT = 4
const LABEL_HALF = 7.5 // the y labels are 14px tall and centred half a pixel above their line
const HATCH_PERIOD = 4.0622 // the target range: Primary/Blue/blue-50 in 2.03px stripes every 4.06px…
const HATCH_STRIPE = 2.0311
const HATCH_SLANT = 0.23689 // …leaning 13.3° to the right going down (x per y)…
const HATCH_PHASE = 1.9675 // …one starting 1.97px in at the top of the plot
const TICK_PITCH = 229 / 19 + 2.5 // the track's ticks, 14.55px apart from its right end (Figma spreads them after the fill)
const TICK_CLEAR = 7 // a tick fades in over 4px once its left edge is 7px past the fill (11px apart at rest, as in Figma)
const TILE = 24
const SNAP_PLOT = 8 // the pointer snaps to a transaction within 8px of its time on the chart…
const SNAP_TRACK = 12 // …and anywhere over its tile on the timeline
const LABEL_EDGE = 48 // round times closer than this to an end of the timeline are left out
const LABEL_SPACING = 78 // and there is about one per 78px
const TIP_GAP = 12
const TIP_PADDING_X = 24 // the tooltip's 12px side padding, twice
const TIP_PADDING_Y = 16 // and its 8px top and bottom padding
const DRAW_AT = 350
const DRAW_DURATION = 1400
const RIDE = 450
const CURSOR_DASH = fittedDash(PLOT_HEIGHT)
const MINUTE = 60_000

const tiles: Record<CashBalanceTone, string> = {
  // Figma: the colour with a 1px ring (blue-400 around the blue tile), a soft drop shadow and a 32% white inner glow
  yellow: "bg-primary-yellow-500 shadow-[0_3px_6px_rgb(0_0_0/0.2),0_0_0_1px_var(--primary-yellow-500),inset_0_0_6px_2px_rgb(255_255_255/0.32)]",
  green: "bg-primary-green-500 shadow-[0_3px_6px_rgb(0_0_0/0.2),0_0_0_1px_var(--primary-green-500),inset_0_0_6px_2px_rgb(255_255_255/0.32)]",
  blue: "bg-primary-blue-500 shadow-[0_3px_6px_rgb(0_0_0/0.2),0_0_0_1px_var(--primary-blue-400),inset_0_0_6px_2px_rgb(255_255_255/0.32)]",
  purple: "bg-primary-purple-500 shadow-[0_3px_6px_rgb(0_0_0/0.2),0_0_0_1px_var(--primary-purple-500),inset_0_0_6px_2px_rgb(255_255_255/0.32)]",
  orange: "bg-primary-orange-500 shadow-[0_3px_6px_rgb(0_0_0/0.2),0_0_0_1px_var(--primary-orange-500),inset_0_0_6px_2px_rgb(255_255_255/0.32)]",
}

const dots: Record<CashBalanceTone, string> = {
  yellow: "bg-primary-yellow-500",
  green: "bg-primary-green-500",
  blue: "bg-primary-blue-500",
  purple: "bg-primary-purple-500",
  orange: "bg-primary-orange-500",
}

const DAY_START = Date.UTC(2025, 5, 12, 6) // Thursday 12 June 2025, 6:00 (UTC)
const at = (hours: number, minutes = 0) => DAY_START + ((hours - 6) * 60 + minutes) * MINUTE
const SAMPLE_NOW = at(9, 34)

// The Figma line: the balance every 2 minutes from 6 AM to 5 PM, read off the drawn curve on the $5K–$20K axis
// (0.01px from it on average). The timeline is filled up to 9:34 AM, so that is now and the rest of the day is projected.
const BALANCE = [
  13943.87, 13745.45, 13506.38, 13277.88, 13107.09, 13015.11, 12998.81, 13021.65, 13073.68, 13140.66, 13194.43, 13219.33, 13221.22, 13221.22,
  13221.22, 13221.22, 13221.22, 13221.22, 13222.21, 13226.4, 13235.59, 13251.48, 13274.44, 13304.34, 13364.99, 13456.27, 13563.35, 13670.52,
  13762.36, 13829.89, 13888.25, 13934.93, 13966.61, 13983.89, 13989.68, 13986.97, 13974.51, 13947.8, 13903.07, 13840.23, 13762.34, 13623.54,
  13425.64, 13224.95, 13073.47, 12995.99, 12988.87, 13014.51, 13070.87, 13158.4, 13268.71, 13386.53, 13497.8, 13599.35, 13696.22, 13793.98, 13898.15,
  14013.86, 14141.04, 14265.74, 14369.09, 14438.55, 14472.32, 14473.58, 14432.76, 14346.07, 14223.26, 14090.19, 13978.97, 13900.49, 13836.2, 13789.4,
  13760.7, 13746.76, 13743.14, 13747.11, 13760.98, 13788.73, 13833.03, 13892.79, 13964.73, 14058.42, 14162.42, 14253.84, 14315.9, 14343.49, 14336.6,
  14286.34, 14195.7, 14096.62, 14029.32, 14006.98, 14040.82, 14153.04, 14324.1, 14485.72, 14578.97, 14596.23, 14564.85, 14490.51, 14378.47, 14248.33,
  14128.38, 14037.37, 13967.52, 13909.45, 13853.82, 13791.13, 13712.38, 13558.85, 13282.19, 12964.4, 12698.94, 12541.89, 12505.56, 12549.67,
  12659.65, 12808.44, 12933.9, 12996.38, 13000.8, 12979.63, 12932.09, 12854.98, 12752.09, 12634.22, 12510.65, 12389.28, 12286.4, 12214.29, 12175.57,
  12166.1, 12178.23, 12212.7, 12272.06, 12353.22, 12446.36, 12536.83, 12607.34, 12668.13, 12723.63, 12775.61, 12825, 12872.34, 12917.95, 12962.01,
  13004.64, 13119.36, 13291.4, 13485.67, 13690.8, 13900.83, 14111.47, 14318.6, 14516.97, 14697.51, 14836.98, 14915.86, 15267.59, 15459.24, 15518.84,
  15567.06, 15609.8, 15651.51, 15696.68, 15749.55, 15817.23, 15897.92, 15983.9, 16067.03, 16139.34, 16196.29, 16255.56, 16314.88, 16365.09, 16399.23,
  16414.25, 16405.39, 16367.08, 16307.07, 16228.93, 16133.62, 16019.99, 15883.85, 15713.98, 15507.38, 15261.57, 15020.56, 14800.92, 14332.69,
  13619.68, 12884.85, 12331.5, 12056.73, 12028.39, 12029.16, 12030.64, 12032.34, 12033.56, 12034.01, 12029.07, 12009.86, 11978.96, 11948.31, 11929.6,
  11925.52, 11948.62, 12008.14, 12090.03, 12160.21, 12195.96, 12198.99, 12186.78, 12162.27, 12133.19, 12111.71, 12103.09, 12119.07, 12190, 12308.35,
  12429.61, 12506.38, 12527.07, 12504.73, 12442.8, 12354.68, 12276.67, 12235.15, 12230.59, 12249.45, 12294.94, 12371.87, 12478.54, 12605.19,
  12742.44, 12884.01, 13009.86, 13102.1, 13154.3, 13169.56, 13127.1, 12994.06, 12762.42, 12447.54, 12092.42, 11744.24, 11419.54, 11145.7, 10948.58,
  10832.93, 10786.64, 10796.17, 10867.73, 10996.77, 11137.85, 11233.65, 11265.46, 11202.36, 10993.19, 10674.31, 10373.04, 10199.23, 10167.75,
  10241.87, 10412.13, 10635.61, 10826.79, 10927.48, 10937.58, 10891.89, 10698.51, 10388.19, 10210.03, 10103.11, 10042.82, 10016.72, 10027.55,
  10120.65, 10282.23, 10476.04, 10661, 10803.71, 10884.67, 10900.27, 10865.54, 10782.75, 10665.83, 10547.23, 10463.66, 10435.4, 10525.83, 10773.14,
  11091.36, 11358.86, 11502.47, 11510.81, 11400.41, 11245.4, 11098.39, 10958.04, 10823.93, 10696.3, 10576.19, 10502.71, 10582.79, 10726.89, 10900.85,
  11089.94, 11285.26, 11479.76, 11666.21, 11835.02, 11969.51, 12028.4, 12049.24, 12092.07, 12147.01, 12209.27, 12275.8, 12344.19, 12411.87, 12475.01,
  12524.68, 12478.21, 12337.52, 12158.96, 11963.18, 11762.24, 11566.17, 11386.97, 11245.04,
]

const sampleCashBalanceData: CashBalancePoint[] = BALANCE.map((value, i) => {
  const time = DAY_START + i * 2 * MINUTE
  return time > SAMPLE_NOW ? { time, value, projected: true } : { time, value }
})

// The Figma tiles, at the times their positions give (the three expenses add up to "Expenses today").
const sampleCashBalanceTransactions: CashBalanceTransaction[] = [
  { id: "card", time: at(9, 20), label: "Card payment", amount: -1029.1, icon: <CreditCardIcon />, tone: "yellow" },
  { id: "lunch", time: at(11, 54), label: "Lunch", amount: -24.5, icon: <FastFoodIcon />, tone: "green" },
  { id: "shopping", time: at(13, 28), label: "Shopping", amount: -186.4, icon: <ShoppingBagIcon />, tone: "blue" },
  { id: "savings", time: at(15, 46), label: "Savings transfer", amount: -500, icon: <PiggyBankIcon />, tone: "purple" },
]

const sampleCashBalanceRange: [number, number] = [10000, 15000]

const sampleCashBalanceSummary: CashBalanceStat[] = [
  { label: "Expenses today", value: 1240 },
  { label: "Net cash flow", value: 3780 },
  { label: "Savings goal", value: 25000 },
]

/** Four round ticks around the data and the range, with half the data's span free above and below (the line keeps to the middle of the plot, as in Figma). */
function valueTicks(values: number[], range: [number, number] | null) {
  const all = range ? [...values, ...range] : values
  if (!all.length) return niceTicks(0, 100, TICK_COUNT)
  const min = Math.min(...all)
  const max = Math.max(...all)
  const pad = (max - min) / 2
  return niceTicks(min >= 0 ? Math.max(0, min - pad) : min - pad, max + pad, TICK_COUNT)
}

/** The last item that passes `test` (Array.findLast needs ES2023 typings, which many projects don't load). */
function findLast<T>(items: T[], test: (item: T) => boolean) {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i])) return items[i]
  return undefined
}

/** The index of the point nearest to `time` (points oldest first). */
function nearestIndex(points: CashBalancePoint[], time: number) {
  if (!points.length) return -1
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].time <= time) lo = mid
    else hi = mid
  }
  return time - points[lo].time <= points[hi].time - time ? lo : hi
}

const round = (n: number) => Math.round(n * 1000) / 1000

/** The hatch of the target range: parallel stripes over the whole plot (the band's clip shows a part of them). */
function hatchPath(width: number) {
  const reach = HATCH_SLANT * PLOT_HEIGHT
  let d = ""
  for (let x = HATCH_PHASE - Math.ceil((reach + HATCH_STRIPE + HATCH_PHASE) / HATCH_PERIOD) * HATCH_PERIOD; x < width; x += HATCH_PERIOD)
    d += `M${round(x)} 0h${HATCH_STRIPE}l${round(reach)} ${PLOT_HEIGHT}h${-HATCH_STRIPE}Z`
  return d
}

/** The timeline's ticks, from its right end leftwards: 2 × 6 dividers and 3 × 10 bars in turn. */
function trackTicks(width: number) {
  const ticks: { left: number; width: number; height: number; major: boolean }[] = []
  for (let k = 0; ; k++) {
    const major = k % 2 === 1
    const size = major ? 3 : 2
    const left = width - 1 - k * TICK_PITCH - size / 2
    if (left < 0) break
    ticks.push({ left, width: size, height: major ? 10 : 6, major })
  }
  return ticks.reverse()
}

/**
 * Where everything sits at a plot width. Times run across the plot from `start` to `end`; values on the ticks' scale,
 * the highest tick on the first grid line (15.5px down) and the lowest on the last (193.5px). The band runs over its
 * bounds' grid lines, half a pixel past their values, as Figma's does.
 */
function layoutChart(data: CashBalancePoint[], range: [number, number] | null, ticksProp: number[] | undefined, start: number, end: number, width: number, height = PLOT_HEIGHT) {
  const ticks = ticksProp?.length ? [...ticksProp].sort((a, b) => a - b) : valueTicks(data.map((point) => point.value), range)
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const y = (value: number) => (hi > lo ? GRID_BOTTOM - ((value - lo) / (hi - lo)) * (GRID_BOTTOM - GRID_TOP) : (GRID_TOP + GRID_BOTTOM) / 2) * height / PLOT_HEIGHT
  const x = (time: number) => (end > start ? ((time - start) / (end - start)) * width : width / 2)
  const band = range ? { top: Math.max(0, y(Math.max(...range)) - 0.5), bottom: Math.min(height, y(Math.min(...range)) + 0.5) } : null
  return { ticks, y, line: data.map((point) => ({ x: x(point.time), y: y(point.value) })), band }
}

/** A label over an amount in whole units ("$12,560") that counts to new values; the balance and income get a trend line. */
function Figure({
  label,
  value,
  change,
  changeLabel,
  size,
  locale,
  currency,
}: {
  label: string
  value: number
  change?: number
  changeLabel?: string
  size: "large" | "small"
  locale: string
  currency: string
}) {
  const valueRef = React.useRef<HTMLParagraphElement>(null)
  const format = React.useCallback((n: number) => formatCurrency(n, { locale, currency, maximumFractionDigits: 0 }), [locale, currency])
  useCountUp(valueRef, value, format, { duration: 900 })
  const text = format(value)
  return (
    <div data-slot="cash-balance-chart-figure" className="flex min-w-0 flex-1 flex-col items-start gap-2">
      <p className={cn("hug-w text-fg-soft", size === "large" ? "typo-label-02-medium" : "typo-label-01-medium")}>{label}</p>
      <p
        ref={valueRef}
        data-slot="cash-balance-chart-amount"
        data-value={value}
        data-text={text}
        className={cn("hug-w whitespace-nowrap text-fg-loud", size === "large" ? "typo-heading-03-semibold" : "typo-heading-01-semibold")}
      >
        {text}
      </p>
      {change !== undefined && <ChartTrend value={change} label={changeLabel} locale={locale} />}
    </div>
  )
}

type TooltipText = {
  value: string
  time: string
  change?: string
  /** The balance is lower than at the start (red, arrow down). */
  down?: boolean
  changeLabel?: string
  transaction?: { label: string; amount: string; out: boolean; icon: React.ReactNode; tone: CashBalanceTone; note?: string }
}

/** The tooltip's rows. Rendered twice: visible (its numbers count) and as an invisible copy that is measured. */
function TooltipRows({ text, valueRef, changeRef }: { text: TooltipText; valueRef?: React.Ref<HTMLSpanElement>; changeRef?: React.Ref<HTMLSpanElement> }) {
  const transaction = text.transaction
  return (
    <>
      <span className="flex items-center gap-1.5">
        <span ref={valueRef} className="typo-label-03-medium hug-w text-fg-loud">
          {text.value}
        </span>
        <span className="typo-label-02-regular hug-w text-fg-soft">{text.time}</span>
      </span>
      {text.change !== undefined && (
        <span className={cn("flex items-center gap-1", text.down ? "text-error-500" : "text-primary-green-500")}>
          {text.down ? <ArrowCircleDownIcon className="shrink-0" /> : <ArrowCircleUpIcon className="shrink-0" />}
          <span ref={changeRef} className="typo-label-02-medium hug-w">
            {text.change}
          </span>
          {text.changeLabel && <span className="typo-label-02-regular hug-w text-fg-soft">{text.changeLabel}</span>}
        </span>
      )}
      {transaction && (
        <span className="flex items-center gap-1.5">
          <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full text-fg-white [&_svg]:size-2.5", dots[transaction.tone])}>{transaction.icon}</span>
          <span className="typo-label-02-medium hug-w text-fg-normal">{transaction.label}</span>
          <span className={cn("typo-label-02-medium hug-w", transaction.out ? "text-error-500" : "text-primary-green-500")}>{transaction.amount}</span>
          {transaction.note && <span className="typo-label-02-regular hug-w text-fg-soft">{transaction.note}</span>}
        </span>
      )}
    </>
  )
}

/**
 * "Cash Balance Chart" from the Keitoto library: the balance and today's income with their changes, the balance over
 * the day as a blue line over a hatched target range, a timeline of the day's transactions filled up to now, and a
 * grey row of figures. Hover or drag across the chart or the timeline to read the balance at any time: a dashed cursor
 * with a dot rides along the line, the tooltip gives the balance, its change since the start of the day and the
 * transaction at that time, the timeline fills up to it and the transaction's tile pops. Click (or Enter) pins a
 * point; the arrow keys step through the day, stopping at every transaction. Animated with anime.js: the figures count
 * up, the grid draws, the range opens, the line draws itself while the timeline fills up to now and each tile and tick
 * pops in as the line reaches its time; new data morphs the line and the range and counts every figure.
 */
function CashBalanceChart({
  chartOnly = false,
  plotHeight: heightProp = 200,
  eventTimeline = false,
  focusTime,
  title = "Cash Balance",
  icon = <CreditCardIcon />,
  balanceLabel = "Total Balance",
  balance: balanceProp,
  balanceChange = 8.6,
  incomeLabel = "Income today",
  income = 2350,
  incomeChange = 15.3,
  changeLabel = "vs Yesterday",
  data = sampleCashBalanceData,
  range = sampleCashBalanceRange,
  transactions = sampleCashBalanceTransactions,
  now: nowProp,
  start: startProp,
  end: endProp,
  ticks: ticksProp,
  summary = sampleCashBalanceSummary,
  index: indexProp,
  defaultIndex,
  onIndexChange,
  onTransactionClick,
  formatTime: formatTimeProp,
  sinceLabel,
  projectedLabel = "Projected",
  scheduledLabel = "Scheduled",
  onMoreClick,
  locale = "en-US",
  currency = "USD",
  className,
  ...props
}: CashBalanceChartProps) {
  const PLOT_HEIGHT = heightProp
  const n = data.length
  const start = startProp ?? data[0]?.time ?? 0
  const end = endProp ?? data[n - 1]?.time ?? start + 1
  const span = end - start
  const lastActual = findLast(data, (point) => !point.projected) ?? data[n - 1]
  const now = Math.min(Math.max(nowProp ?? lastActual?.time ?? end, start), end)
  const nowIndex = nearestIndex(data, now)
  const balance = balanceProp ?? data[nowIndex]?.value ?? 0

  const [plotRef, plot] = useChartSize<HTMLDivElement>({ width: PLOT_WIDTH, height: PLOT_HEIGHT })
  const [timelineRef, timeline] = useChartSize<HTMLDivElement>({ width: TRACK_WIDTH, height: 60 })
  const width = plot.width || PLOT_WIDTH
  const trackWidth = timeline.width || TRACK_WIDTH
  const { ticks, y, line, band } = React.useMemo(() => layoutChart(data, range, ticksProp, start, end, width, PLOT_HEIGHT), [data, range, ticksProp, start, end, width, PLOT_HEIGHT])
  const plotX = (time: number) => (span > 0 ? ((time - start) / span) * width : width / 2)
  const trackX = (time: number) => (span > 0 ? ((time - start) / span) * trackWidth : trackWidth / 2)
  const hatch = React.useMemo(() => hatchPath(width), [width])
  const marks = React.useMemo(() => trackTicks(trackWidth), [trackWidth])
  // Content keys: parents may pass new arrays on every render, so changes are detected by value.
  const dataKey = `${data.map((p) => `${p.time}=${p.value}`).join(";")}|${ticks.join(";")}|${range?.join(";") ?? ""}|${start}-${end}`
  const ticksKey = ticks.join(";")

  // Transactions inside the period, each with the point at its time.
  const placed = React.useMemo(
    () =>
      transactions
        .filter((transaction) => transaction.time >= start && transaction.time <= end)
        .map((transaction) => ({ transaction, index: nearestIndex(data, transaction.time) })),
    [transactions, data, start, end],
  )

  const [selected, setSelected] = useControllableState<number | null>({
    value: indexProp,
    defaultValue: defaultIndex ?? null,
    onChange: (next) => onIndexChange?.(next, next === null ? undefined : data[next]),
  })
  // A target is a point and, when one is meant, the transaction at it (several can share the last point, e.g. scheduled
  // ones after the data ends).
  const [hovered, setHovered] = React.useState<Target | null>(null)
  const [pinnedId, setPinnedId] = React.useState<string | undefined>(undefined)
  const [focusTargetTime, setFocusTargetTime] = React.useState(focusTime)
  React.useEffect(() => setFocusTargetTime(focusTime), [focusTime])
  const transactionAt = (index: number, id?: string) =>
    (id !== undefined ? placed.find((entry) => entry.transaction.id === id && entry.index === index) : undefined) ?? placed.find((entry) => entry.index === index)
  const pinned = selected !== null && selected >= 0 && selected < n ? selected : null
  const focusIndex = focusTargetTime === undefined ? -1 : data.findIndex(point => point.time === focusTargetTime)
  // Product-action previews end with the interaction; anomaly links locate an exact observation.
  const target: Target | null = hovered !== null && hovered.index >= 0 && hovered.index < n ? hovered : focusIndex >= 0 ? { index: focusIndex } : !eventTimeline && pinned !== null ? { index: pinned, id: pinnedId } : null
  // the cursor fades out where it was: keep the last target
  const [lastTarget, setLastTarget] = React.useState<Target | null>(target)
  if (target !== null && (target.index !== lastTarget?.index || target.id !== lastTarget?.id)) setLastTarget(target)
  const shownTarget = target ?? (lastTarget !== null && lastTarget.index < n ? lastTarget : null)
  const active = target?.index ?? null
  const shown = shownTarget?.index ?? null
  const visible = active !== null
  const point = shown !== null ? data[shown] : undefined
  const cursorX = shown !== null ? (line[shown]?.x ?? 0) : 0
  const cursorY = shown !== null ? (line[shown]?.y ?? 0) : 0
  const activeTransaction = target ? transactionAt(target.index, target.id)?.transaction : undefined
  const shownTransaction = shownTarget ? transactionAt(shownTarget.index, shownTarget.id)?.transaction : undefined
  const pinnedTransaction = pinned !== null ? transactionAt(pinned, pinnedId)?.transaction : undefined
  const fillX = active !== null && data[active] ? trackX(data[active].time) : trackX(now)

  const money = React.useCallback((value: number) => formatCurrency(value, { locale, currency }), [locale, currency])
  const signedMoney = React.useCallback((value: number) => formatCurrency(value, { locale, currency, signDisplay: "exceptZero" }), [locale, currency])
  const timeText = (time: number, context: "axis" | "tooltip") => {
    if (formatTimeProp) return formatTimeProp(time, context)
    const onTheHour = new Date(time).getUTCMinutes() === 0
    return formatTime(time, context === "axis" && onTheHour ? { hour: "numeric" } : { hour: "numeric", minute: "2-digit" }, locale)
  }
  const isProjected = (index: number) => !!data[index] && (!!data[index].projected || data[index].time > now)

  // Round times between the timeline's ends, kept clear of the end labels.
  const labelTimes = React.useMemo(() => {
    if (!(span > 0)) return []
    if (eventTimeline) {
      const count = Math.max(1, Math.floor(trackWidth / LABEL_SPACING));
      return Array.from({length: count - 1}, (_, i) => data[Math.round((i + 1) * (n - 1) / count)]?.time).filter((time): time is number => time !== undefined);
    }
    const { ticks: times } = timeTicks(start, end, Math.max(2, Math.floor(trackWidth / LABEL_SPACING)))
    return times.filter((time) => {
      const x = ((time - start) / span) * trackWidth
      return x >= LABEL_EDGE && x <= trackWidth - LABEL_EDGE
    })
  }, [start, end, span, trackWidth, eventTimeline, data, n])

  const first = eventTimeline ? undefined : data[0]
  const change = point && first ? point.value - first.value : undefined
  const tooltip: TooltipText | undefined = point
    ? {
        value: money(point.value),
        time: shown !== null && isProjected(shown) ? `${timeText(point.time, "tooltip")} · ${projectedLabel}` : timeText(point.time, "tooltip"),
        change: change !== undefined && shown !== 0 ? money(Math.abs(change)) : undefined,
        down: change !== undefined && change < 0,
        changeLabel: sinceLabel ?? (first ? `since ${timeText(first.time, "axis")}` : undefined),
        transaction: shownTransaction
          ? {
              label: shownTransaction.label,
              amount: eventTimeline ? "" : signedMoney(shownTransaction.amount),
              out: shownTransaction.amount < 0,
              icon: shownTransaction.icon,
              tone: shownTransaction.tone ?? "blue",
              note: shownTransaction.time > now ? scheduledLabel : undefined,
            }
          : undefined,
      }
    : undefined

  // The tooltip sits above the point, centred, or under it when there's no room; inside the plot. Its size is measured
  // on an invisible copy that holds the final text.
  const [sizerRef, sizer] = useChartSize<HTMLSpanElement>({ width: 160, height: 38 })
  const tipWidth = sizer.width + TIP_PADDING_X
  const tipHeight = sizer.height + TIP_PADDING_Y
  const tipLeft = Math.round(Math.min(Math.max(cursorX - tipWidth / 2, 0), Math.max(0, width - tipWidth)))
  const tipTop = Math.round(cursorY - TIP_GAP - tipHeight >= 0 ? cursorY - TIP_GAP - tipHeight : Math.min(cursorY + TIP_GAP, PLOT_HEIGHT - tipHeight))

  const reduced = useReducedMotion()
  const root = React.useRef<HTMLDivElement>(null)
  const lineRef = React.useRef<SVGPathElement>(null)
  const hatchRef = React.useRef<SVGPathElement>(null)
  const bandRef = React.useRef<SVGRectElement>(null)
  const cursorRef = React.useRef<SVGGElement>(null)
  const dotRef = React.useRef<SVGCircleElement>(null)
  const tipRef = React.useRef<HTMLDivElement>(null)
  const tipValueRef = React.useRef<HTMLSpanElement>(null)
  const tipChangeRef = React.useRef<HTMLSpanElement>(null)
  const trackRef = React.useRef<SVGSVGElement>(null)
  const fillRef = React.useRef<SVGRectElement>(null)
  const ids = React.useId().replace(/[^\w-]/g, "")
  // what the entrance's callbacks need at play time (the card may be resized or hovered before it plays)
  const latest = React.useRef({ line, fillX, nowX: trackX(now), start, span, trackWidth })
  useIsomorphicLayoutEffect(() => {
    latest.current = { line, fillX, nowX: trackX(now), start, span, trackWidth }
  })
  const all = (selector: string) => Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])

  useCountUp(tipValueRef, point?.value ?? 0, money, { duration: 400 })
  useCountUp(tipChangeRef, Math.abs(change ?? 0), money, { duration: 400 })

  // The fill's end is also a CSS variable on the track (its ticks fade by their distance from it).
  const drawnFill = React.useRef(fillX)
  const fillTween = React.useRef<JSAnimation | null>(null)
  const fillRiding = React.useRef(false)
  const paintFill = (x: number) => {
    drawnFill.current = x
    trackRef.current?.style.setProperty("--fill", String(x))
    fillRef.current?.setAttribute("width", String(Math.max(0, x)))
  }

  // Entrance, once the card is in view: the tile pops, the figures count up, the grid lines draw, the range opens from
  // its middle as its stripes slide in, and the line draws itself left to right; the timeline fills up behind the
  // line's tip until now, and each tick and transaction tile pops in as the tip reaches its time.
  useChartEntrance(root, (timeline) => {
    const path = lineRef.current
    const rect = bandRef.current
    const stripes = hatchRef.current
    const amounts = all('[data-slot="cash-balance-chart-amount"]')
    const { line, nowX, start, span, trackWidth } = latest.current
    const lengths = polylineLengths(line)
    const reach = (time: number) => {
      const x = span > 0 ? ((time - start) / span) * width : 0
      // a time at or before the line's start is reached at once (also when all its points share one x)
      return DRAW_AT + (x <= (line[0]?.x ?? 0) ? 0 : reachAt(line, x, lengths)) * DRAW_DURATION
    }
    const counter = { f: 0 }
    const count = () => {
      for (const el of amounts) {
        el.textContent = formatCurrency(Number(el.dataset.value) * counter.f, { locale, currency, maximumFractionDigits: 0 })
      }
    }
    count()
    paintFill(0)
    timeline
      .add(all('[data-slot="cash-balance-chart-badge"]'), { scale: { from: 0.6 }, opacity: { from: 0 }, duration: 700, ease: "outBack(1.8)" }, 0)
      .add(counter, { f: [0, 1], duration: 1400, ease: "outExpo", onUpdate: count }, 0)
      .add(all('[data-slot="chart-trend"]'), { opacity: { from: 0 }, translateY: { from: 4 }, duration: 600, ease: "outQuad", delay: stagger(80) }, 250)
      .add(all('[data-slot="cash-balance-chart-grid-line"]'), { x2: { from: 0 }, duration: 900, ease: "outExpo", delay: stagger(70) }, 100)
      .add(all('[data-slot="cash-balance-chart-tick"]'), { opacity: { from: 0 }, translateX: { from: -4 }, duration: 600, ease: "outQuad", delay: stagger(45) }, 200)
      .add(all('[data-slot="cash-balance-chart-time"]'), { opacity: { from: 0 }, translateY: { from: 4 }, duration: 600, ease: "outQuad", delay: stagger(60) }, 300)
      .add(all('[data-slot="cash-balance-chart-summary"]'), { opacity: { from: 0 }, translateY: { from: 8 }, duration: 800, ease: "outExpo" }, 450)
    if (rect) {
      const top = Number(rect.getAttribute("y"))
      const height = Number(rect.getAttribute("height"))
      timeline.add(rect, { y: { from: top + height / 2 }, height: { from: 0 }, duration: 900, ease: "outExpo" }, 300)
    }
    if (stripes) timeline.add(stripes, { translateX: { from: -3 * HATCH_PERIOD }, duration: 1300, ease: "outExpo" }, 300)
    if (path) {
      timeline.add(svg.createDrawable(path), { draw: ["0 0", "0 1"], duration: DRAW_DURATION, ease: "inOutSine" }, DRAW_AT)
      // the timeline fills up behind the line's tip, as far as now
      const tip = { f: 0 }
      timeline.add(
        tip,
        {
          f: [0, 1],
          duration: DRAW_DURATION,
          ease: "inOutSine",
          onUpdate: () => {
            const current = latest.current
            if (current.fillX !== current.nowX || fillRiding.current) return // a hover owns the fill
            const x = xAtLength(current.line, tip.f)
            const time = current.start + (width > 0 ? (x / width) * current.span : 0)
            paintFill(Math.min(current.nowX, current.span > 0 ? ((time - current.start) / current.span) * current.trackWidth : 0))
          },
          onComplete: () => {
            if (!fillRiding.current) paintFill(latest.current.fillX)
          },
        },
        DRAW_AT,
      )
    } else paintFill(nowX)
    for (const tile of all('[data-slot="cash-balance-chart-tile-pop"]')) {
      timeline.add(tile, { scale: { from: 0 }, duration: 550, ease: "outBack(2.2)" }, Math.max(0, reach(Number(tile.dataset.time)) - 80))
    }
    for (const mark of all('[data-slot="cash-balance-chart-mark"]')) {
      const left = Number(mark.dataset.left)
      // the ticks the fill ends up over stay hidden until it has covered them
      if (left < nowX + TICK_CLEAR) timeline.add(mark, { scaleY: { from: 0 }, duration: 1 }, DRAW_AT + DRAW_DURATION)
      else timeline.add(mark, { scaleY: { from: 0 }, duration: 450, ease: "outBack(2.5)" }, Math.max(0, reach(start + (left / trackWidth) * span) - 60))
    }
    return () => {
      // createDrawable leaves its dash attributes (revert sets them to "hidden"): give the plain line back
      for (const attribute of ["pathLength", "stroke-dasharray", "stroke-dashoffset"]) path?.removeAttribute(attribute)
      for (const el of amounts) el.textContent = el.dataset.text ?? el.textContent
      paintFill(latest.current.fillX)
    }
  }, {enabled: n > 0, replayKey: data.map(p => p.time).join(";")})

  // A new active time sends the fill riding to it (and back to now when the pointer leaves); ticks fade as it passes.
  const lastFill = React.useRef({ fillX, trackWidth })
  useIsomorphicLayoutEffect(() => {
    const before = lastFill.current
    lastFill.current = { fillX, trackWidth }
    if (before.fillX === fillX && before.trackWidth === trackWidth) return
    fillTween.current?.cancel()
    fillRiding.current = false
    if (reduced || before.trackWidth !== trackWidth) {
      paintFill(fillX)
      return
    }
    const state = { x: drawnFill.current }
    const done = () => {
      fillRiding.current = false
      paintFill(fillX)
    }
    fillRiding.current = true
    paintFill(state.x)
    fillTween.current = animate(state, { x: fillX, duration: 500, ease: "outExpo", onUpdate: () => paintFill(state.x), onComplete: done })
  }, [fillX, trackWidth, reduced])

  // A new point sends the cursor and its dot riding along the line to it and slides the tooltip over; the cursor pops
  // in where the pointer enters and fades out where it leaves.
  const drawnX = React.useRef(cursorX)
  const ride = React.useRef<JSAnimation | null>(null)
  const lastCursor = React.useRef({ shown, visible, width, dataKey, tipLeft, tipTop })
  useIsomorphicLayoutEffect(() => {
    const before = lastCursor.current
    lastCursor.current = { shown, visible, width, dataKey, tipLeft, tipTop }
    const group = cursorRef.current
    const dot = dotRef.current
    const tip = tipRef.current
    const settle = () => {
      drawnX.current = cursorX
      group?.style.removeProperty("transform")
      dot?.style.removeProperty("translate")
    }
    if (reduced || before.width !== width || before.dataKey !== dataKey || !visible) {
      if (visible || reduced) {
        ride.current?.cancel()
        settle()
      }
      return
    }
    if (!before.visible) {
      ride.current?.cancel()
      settle()
      if (dot) animate(dot, { scale: [0, 1], duration: 380, ease: "outBack(2.4)", onComplete: releaseStyles("transform") })
      if (tip) animate(tip, { translateY: [tipTop > cursorY ? -4 : 4, 0], scale: [0.96, 1], duration: 300, ease: "outQuad", onComplete: releaseStyles("transform") })
      return
    }
    if (tip && (before.tipLeft !== tipLeft || before.tipTop !== tipTop))
      animate(tip, {
        translateX: [before.tipLeft - tipLeft + utils.get(tip, "translateX", false), 0],
        translateY: [before.tipTop - tipTop + utils.get(tip, "translateY", false), 0],
        duration: RIDE,
        ease: "outExpo",
        onComplete: releaseStyles("transform"),
      })
    const from = drawnX.current
    if (from === cursorX) return
    const state = { x: from }
    const paint = () => {
      drawnX.current = state.x
      if (group) group.style.transform = `translateX(${state.x - cursorX}px)`
      if (dot) dot.style.translate = `0 ${valueAt(line, state.x) - cursorY}px`
    }
    ride.current?.cancel()
    paint()
    ride.current = animate(state, { x: cursorX, duration: RIDE, ease: "outExpo", onUpdate: paint, onComplete: settle })
  }, [shown, visible, width, dataKey, tipLeft, tipTop, reduced])

  // New data morphs the line (both versions resampled on the same x positions) and the range.
  const lastData = React.useRef({ key: dataKey, line, band })
  const morph = React.useRef<JSAnimation | null>(null)
  useIsomorphicLayoutEffect(() => {
    const before = lastData.current
    lastData.current = { key: dataKey, line, band }
    if (before.key === dataKey) return
    morph.current?.cancel()
    const path = lineRef.current
    const rect = bandRef.current
    if (reduced) return
    const pair = before.line.length && line.length ? alignPolylines(before.line, line) : null
    const bands = before.band && band ? { from: before.band, to: band } : null
    const draw = (t: number) => {
      if (pair) path?.setAttribute("d", smoothPath(pair.xs.map((x, i) => ({ x, y: pair.from[i] + (pair.to[i] - pair.from[i]) * t }))))
      if (bands && rect) {
        const top = bands.from.top + (bands.to.top - bands.from.top) * t
        const bottom = bands.from.bottom + (bands.to.bottom - bands.from.bottom) * t
        rect.setAttribute("y", String(top))
        rect.setAttribute("height", String(Math.max(0, bottom - top)))
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
        path?.setAttribute("d", smoothPath(line))
        if (rect && band) {
          rect.setAttribute("y", String(band.top))
          rect.setAttribute("height", String(band.bottom - band.top))
        }
      },
    })
    if (!pair && path) animate(path, { opacity: [0, 1], duration: 500, ease: "outQuad", onComplete: releaseStyles("opacity") })
  }, [dataKey, width, reduced])
  React.useEffect(
    () => () => {
      ride.current?.cancel()
      morph.current?.cancel()
      fillTween.current?.cancel()
    },
    [],
  )

  // New ticks fade their labels in again.
  const lastTicks = React.useRef(ticksKey)
  useIsomorphicLayoutEffect(() => {
    const before = lastTicks.current
    lastTicks.current = ticksKey
    if (before === ticksKey || reduced) return
    animate(all('[data-slot="cash-balance-chart-tick"]'), { opacity: [0, 1], duration: 500, delay: stagger(35), ease: "outQuad", onComplete: releaseStyles("opacity") })
  }, [ticksKey, reduced])

  const hover = (next: Target | null) => {
    setHovered(next)
    if (next === null) setFocusTargetTime(undefined)
  }
  /** Pins the target, or unpins it when it is the pinned one. */
  const toggle = (next: Target) => {
    const same = pinned === next.index && transactionAt(next.index, next.id)?.transaction === pinnedTransaction
    setPinnedId(same ? undefined : next.id)
    setSelected(same ? null : next.index)
  }
  /** The point under x (in the plot's or the timeline's pixels), snapping to a transaction close by. */
  const pick = (x: number, scale: "plot" | "track"): Target => {
    const toX = scale === "plot" ? plotX : trackX
    let best: Target | null = null
    let distance = scale === "plot" ? SNAP_PLOT : SNAP_TRACK
    for (const entry of placed) {
      const d = Math.abs(toX(entry.transaction.time) - x)
      if (d <= distance) {
        best = { index: entry.index, id: entry.transaction.id }
        distance = d
      }
    }
    if (best) return best
    const size = scale === "plot" ? width : trackWidth
    return { index: nearestIndex(data, start + (size > 0 ? (x / size) * span : 0)) }
  }
  // Pointer positions in the element's own pixels (the live demo may scale the card with CSS zoom).
  const pointerX = (event: React.PointerEvent<HTMLElement>) => {
    const element = event.currentTarget
    const box = element.getBoundingClientRect()
    const zoom = box.width / (element.offsetWidth || box.width || 1) || 1
    return (event.clientX - box.left) / zoom
  }

  // The arrow keys step a 66th of the points (10 minutes in the sample, at least a point) and stop at every transaction.
  const stops = React.useMemo(() => {
    if (!n) return []
    const step = Math.max(1, Math.round((n - 1) / 66))
    const set = new Set<number>([0, n - 1])
    for (let i = 0; i < n; i += step) set.add(i)
    for (const entry of placed) set.add(entry.index)
    return [...set].sort((a, b) => a - b)
  }, [n, placed])
  const position = active ?? Math.max(0, nowIndex)
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!n) return
    if (event.key === "Escape") {
      hover(null)
      setPinnedId(undefined)
      setSelected(null)
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      toggle(target ?? { index: position })
      return
    }
    const page = Math.max(1, Math.round((n - 1) / 11))
    const keys: Record<string, () => number | undefined> = {
      ArrowRight: () => stops.find((stop) => stop > position),
      ArrowUp: () => stops.find((stop) => stop > position),
      ArrowLeft: () => findLast(stops, (stop) => stop < position),
      ArrowDown: () => findLast(stops, (stop) => stop < position),
      PageUp: () => Math.min(n - 1, position + page),
      PageDown: () => Math.max(0, position - page),
      Home: () => 0,
      End: () => n - 1,
    }
    if (!keys[event.key]) return
    event.preventDefault()
    const next = keys[event.key]()
    if (next !== undefined) hover({ index: next })
  }

  const describe = (index: number) => {
    const at = data[index]
    if (!at) return ""
    const transaction = placed.find((entry) => entry.index === index)?.transaction
    return `${timeText(at.time, "tooltip")}: ${money(at.value)}${isProjected(index) ? ` (${projectedLabel.toLowerCase()})` : ""}${transaction ? `, ${transaction.label}${eventTimeline ? "" : ` ${signedMoney(transaction.amount)}`}` : ""}`
  }
  const gridDash = fittedDash(width, 5, 5)

  return (
    <ChartCard ref={root} role="group" aria-label={title} className={cn("w-full", chartOnly && "revenue-cash-chart", className)} {...props}>
      {!chartOnly && <><div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Figma: #429bff with a white sheen over its top, a 1px #429bff → #3393ff inside stroke, an inner shadow at the
              bottom and two soft drop shadows */}
          <span
            data-slot="cash-balance-chart-badge"
            className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#429bff] text-fg-white shadow-[0_4px_4px_-3px_rgb(0_0_0/0.16),inset_0_-2px_3px_rgb(0_0_0/0.08),0_2px_4px_rgb(1_1_1/0.08)] [&_svg]:size-3.5"
          >
            <span aria-hidden className="absolute inset-x-0 -top-2.5 h-[22px] bg-linear-to-b from-white/60 to-white/0" />
            <span className="relative flex">{icon}</span>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent bg-linear-to-b from-[#429bff] to-[#3393ff] bg-origin-border [mask:linear-gradient(#000_0_0)_padding-box_exclude,linear-gradient(#000_0_0)]"
            />
          </span>
          {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
          <p className="typo-heading-01-semibold -my-0.5 min-w-0 truncate py-0.5 text-fg-loud">{title}</p>
        </div>
        <ChartButton corner="rounded" size="icon" aria-label="More options" onClick={onMoreClick}>
          <DotsHorizontalIcon />
        </ChartButton>
      </div>

      <div className="flex items-center gap-3">
        <Figure label={balanceLabel} value={balance} change={balanceChange} changeLabel={changeLabel} size="large" locale={locale} currency={currency} />
        <Figure label={incomeLabel} value={income} change={incomeChange} changeLabel={changeLabel} size="large" locale={locale} currency={currency} />
      </div>

      </>}

      {/* Figma's chart row hugs its 354px plot, 8px short of the card's content edge */}
      <div className="cash-balance-plot-row flex items-start gap-3 pr-2">
        {/* Figma "Y Axis Labels": 34px wide, each label centred half a pixel above its grid line, left-aligned */}
        <div aria-hidden className="relative w-[34px] shrink-0 self-stretch">
          {[...ticks].reverse().map((tick) => (
            <span
              key={tick}
              data-slot="cash-balance-chart-tick"
              className="typo-label-02-regular absolute left-0 whitespace-nowrap text-fg-soft"
              style={{ top: y(tick) - LABEL_HALF }}
            >
              {formatCompactCurrency(tick, { locale, currency })}
            </span>
          ))}
        </div>

        <div ref={plotRef} data-slot="cash-balance-chart-plot" className="relative min-w-0 flex-1" style={{ height: PLOT_HEIGHT }}>
          <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
            <defs>
              {band && (
                <clipPath id={`${ids}-band`}>
                  <rect ref={bandRef} x={0} y={band.top} width={width} height={band.bottom - band.top} />
                </clipPath>
              )}
            </defs>
            {/* Figma "Grid Line": 1px Border/Soft, dashed 5/5 and fitted to the width */}
            {ticks.map((tick) => (
              <line key={tick} data-slot="cash-balance-chart-grid-line" x1={0} x2={width} y1={y(tick)} y2={y(tick)} className="stroke-border-soft" {...gridDash} />
            ))}
            {band && (
              <g clipPath={`url(#${ids}-band)`}>
                <path ref={hatchRef} data-slot="cash-balance-chart-range" d={hatch} className="fill-primary-blue-50" />
              </g>
            )}
            {n > 0 && (
              // the balance: a 2px blue-500 line with a soft blue drop shadow (Figma: #429bff at 40%, 0 3 3)
              <path
                ref={lineRef}
                data-slot="cash-balance-chart-line"
                d={smoothPath(line)}
                fill="none"
                strokeWidth={2}
                className="stroke-primary-blue-500 [filter:drop-shadow(0_3px_1.5px_rgb(83_58_253/0.2))]"
              />
            )}
            {point && (
              <g
                ref={cursorRef}
                data-slot="cash-balance-chart-cursor"
                className={cn("transition-opacity duration-200 motion-reduce:transition-none", !visible && "opacity-0")}
              >
                <line x1={cursorX} x2={cursorX} y1={0} y2={PLOT_HEIGHT} className="stroke-surface-subdued" {...CURSOR_DASH} />
                <circle ref={dotRef} cx={cursorX} cy={cursorY} r={4} strokeWidth={2} className="origin-center fill-surface-white stroke-primary-blue-500 [transform-box:fill-box]" />
              </g>
            )}
          </svg>

          <div
            role="slider"
            tabIndex={n ? 0 : -1}
            aria-label={`${title} 趋势${range ? `, ${eventTimeline ? '中间 50% 区间' : 'target range'} ${money(Math.min(...range))} to ${money(Math.max(...range))}` : ""}`}
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, n - 1)}
            aria-valuenow={position}
            aria-valuetext={describe(position) || undefined}
            data-slot="cash-balance-chart-scrubber"
            onPointerMove={(event) => hover(pick(pointerX(event), "plot"))}
            onPointerDown={(event) => {
              // a tap or a drag across the plot reads the balance on touch screens
              if (event.pointerType !== "mouse") hover(pick(pointerX(event), "plot"))
            }}
            onPointerLeave={() => hover(null)}
            onPointerUp={(event) => {
              if (event.button === 0) toggle(pick(pointerX(event), "plot"))
            }}
            onFocus={(event) => {
              if (!eventTimeline || event.currentTarget.matches(":focus-visible"))
                setHovered((at) => at ?? (pinned !== null ? { index: pinned, id: pinnedId } : { index: Math.max(0, nowIndex) }))
            }}
            onBlur={() => hover(null)}
            onKeyDown={onKeyDown}
            className="absolute inset-0 cursor-pointer touch-pan-y rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary-blue-500/40"
          />

          {tooltip && (
            <div
              ref={tipRef}
              aria-hidden
              data-slot="cash-balance-chart-tooltip"
              className={cn(
                "pointer-events-none absolute z-10 flex flex-col items-start gap-2 rounded-xl bg-surface-white px-3 py-2 whitespace-nowrap transition-opacity duration-200 motion-reduce:transition-none",
                // Figma paints later effects on top; CSS paints the first shadow on top
                "shadow-[0_0_0_1px_#ececec,0_2px_4px_rgb(0_0_0/0.06),0_4px_16px_rgb(0_0_0/0.08)]",
                !visible && "opacity-0",
              )}
              style={{ left: tipLeft, top: tipTop }}
            >
              <TooltipRows text={tooltip} valueRef={tipValueRef} changeRef={tipChangeRef} />
            </div>
          )}
          {/* the same rows with their final text, measured to place the tooltip (the visible ones change width while they count) */}
          {tooltip && (
            <span ref={sizerRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex flex-col items-start gap-2 whitespace-nowrap">
              <TooltipRows text={tooltip} />
            </span>
          )}
        </div>
      </div>

      {/* The timeline: the day's transactions over a track that fills up to now (or to the time under the pointer) */}
      <div
        ref={timelineRef}
        data-slot="cash-balance-chart-timeline"
        className="cash-balance-timeline flex touch-pan-y flex-col gap-1.5"
        onPointerMove={(event) => hover(pick(pointerX(event), "track"))}
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse") hover(pick(pointerX(event), "track"))
        }}
        onPointerLeave={() => hover(null)}
        onPointerUp={(event) => {
          // the tiles pin their own point
          if (event.button === 0 && !(event.target as Element).closest("button")) toggle(pick(pointerX(event), "track"))
        }}
      >
        {placed.length > 0 && <div className="relative h-6">
          {placed.map(({ transaction, index }) => {
            const tone = transaction.tone ?? "blue"
            const scheduled = transaction.time > now
            const isActive = activeTransaction === transaction
            return (
              <button
                key={transaction.id}
                type="button"
                data-slot="cash-balance-chart-transaction"
                aria-label={`${transaction.label}${eventTimeline ? "" : `: ${signedMoney(transaction.amount)}`}, ${timeText(transaction.time, "tooltip")}${scheduled ? `, ${scheduledLabel.toLowerCase()}` : ""}`}
                aria-pressed={pinnedTransaction === transaction}
                onFocus={(event) => {
                  if (!eventTimeline || event.currentTarget.matches(":focus-visible")) hover({ index, id: transaction.id })
                }}
                onBlur={() => hover(null)}
                onClick={() => {
                  toggle({ index, id: transaction.id })
                  onTransactionClick?.(transaction)
                }}
                // the ring sits 4px out, clear of the tile popping to 115%
                className="absolute top-0 size-6 cursor-pointer rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-blue-500/40 focus-visible:outline-solid"
                style={{ left: Math.round(trackX(transaction.time) - TILE / 2) }}
              >
                <span data-slot="cash-balance-chart-tile-pop" data-time={transaction.time} className="block size-full">
                  <span
                    data-active={isActive || undefined}
                    className={cn(
                      "relative flex size-full items-center justify-center overflow-hidden rounded-full text-fg-white transition-[scale] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none data-active:scale-[1.15] [&_svg]:size-3.5",
                      tiles[tone],
                    )}
                  >
                    {transaction.icon}
                    {/* Figma: a 1px inside stroke, white fading from 16% to 8% */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-full border border-transparent bg-linear-to-b from-white/16 to-white/8 bg-origin-border [mask:linear-gradient(#000_0_0)_padding-box_exclude,linear-gradient(#000_0_0)]"
                    />
                  </span>
                </span>
              </button>
            )
          })}
        </div>}

        <svg ref={trackRef} aria-hidden data-slot="cash-balance-chart-track" className="block h-2.5 w-full overflow-visible" style={{ "--fill": fillX } as React.CSSProperties}>
          <defs>
            {/* Figma: #f0f0f0 at 40% on the left to #429bff at the fill's end (interpolated unpremultiplied, as SVG does) */}
            <linearGradient id={`${ids}-fill`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#f0f0f0" stopOpacity={0.4} />
              <stop offset="1" stopColor="var(--revenue-line, #533afd)" />
            </linearGradient>
          </defs>
          <rect ref={fillRef} data-slot="cash-balance-chart-fill" x={0} y={1} width={Math.max(0, fillX)} height={8} rx={4} fill={`url(#${ids}-fill)`} />
          {marks.map((mark) => (
            <g key={mark.left} data-slot="cash-balance-chart-mark" data-left={mark.left} className="origin-center [transform-box:fill-box]">
              <rect
                x={mark.left}
                y={(10 - mark.height) / 2}
                width={mark.width}
                height={mark.height}
                rx={mark.width / 2}
                // dividers in #f2f2f2, bars in #ebebeb (unbound in Figma)
                className={mark.major ? "fill-surface-soft" : "fill-[#f2f2f2]"}
                style={{ opacity: `clamp(0, calc((${round(mark.left)} - var(--fill) - ${TICK_CLEAR}) / 4), 1)` }}
              />
            </g>
          ))}
        </svg>

        <div aria-hidden className="relative h-3.5">
          {n > 0 && (
            <>
              <span data-slot="cash-balance-chart-time" className="typo-label-02-regular absolute top-0 left-0 whitespace-nowrap text-fg-soft">
                {timeText(start, "axis")}
              </span>
              {labelTimes.map((time) => (
                <span key={time} data-slot="cash-balance-chart-time" className="absolute top-0" style={{ left: trackX(time) }}>
                  <span className="typo-label-02-regular block -translate-x-1/2 whitespace-nowrap text-fg-soft">{timeText(time, "axis")}</span>
                </span>
              ))}
              <span data-slot="cash-balance-chart-time" className="typo-label-02-regular absolute top-0 right-0 whitespace-nowrap text-fg-soft">
                {timeText(end, "axis")}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Figma "Expenses Today Content": Background/Disable, 14px corners */}
      {summary.length > 0 && (
        <div data-slot="cash-balance-chart-summary" className="flex items-center gap-3 rounded-[14px] bg-surface-disable px-4 py-3">
          {summary.map((stat, i) => (
            <Figure key={`${i}-${stat.label}`} label={stat.label} value={stat.value} size="small" locale={locale} currency={currency} />
          ))}
        </div>
      )}
    </ChartCard>
  )
}

export {
  CashBalanceChart,
  sampleCashBalanceData,
  sampleCashBalanceRange,
  sampleCashBalanceSummary,
  sampleCashBalanceTransactions,
  type CashBalanceChartProps,
  type CashBalancePoint,
  type CashBalanceStat,
  type CashBalanceTone,
  type CashBalanceTransaction,
}
