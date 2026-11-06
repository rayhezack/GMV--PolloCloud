"use client"

import { animate, stagger, type JSAnimation } from "animejs"
import * as React from "react"

import { ChartButton } from "@/components/ui/chart-button"
import { ChartCard } from "@/components/ui/chart-card"
import { ChartChangeBadge } from "@/components/ui/chart-change-badge"
import { DotsHorizontalIcon } from "@/components/ui/chart-icons"
import { ChartSegmentedControl } from "@/components/ui/chart-segmented-control"
import { releaseStyles, useChartEntrance, useCountUp, useIsomorphicLayoutEffect, useReducedMotion } from "@/hooks/use-chart-motion"
import { useControllableState } from "@/hooks/use-controllable-state"
import { sectorPath } from "@/lib/chart-arcs"
import { formatCurrency, formatPercent } from "@/lib/chart-format"
import { cn } from "@/lib/utils"

type ExpensesColor = "orange" | "green" | "yellow" | "blue" | "purple" | "teal"

/** A kind of spending: a segment of the ring and a row beside it. */
type ExpensesCategory = { id: string; label: string; color?: ExpensesColor }

/** One segment of the Week / Month / Year control and what was spent in it. */
type ExpensesPeriod = {
  value: string
  label: string
  /** What each category spent in the period, by category id (a missing one is 0). */
  values: Record<string, number>
  /** The period's budget: the whole ring, its hatched part what is left. Without one the categories share the ring. */
  budget?: number
  /** The previous period's total: the badge shows the change from it. */
  previous?: number
  /** After the badge ("vs last week"). */
  changeLabel?: string
}

type ExpensesChartProps = Omit<React.ComponentProps<"div">, "children"> & {
  title?: string
  /** The label over the total. */
  totalLabel?: string
  /** What the hatched part of the ring is called in the middle while it is pointed at. */
  remainingLabel?: string
  categories?: ExpensesCategory[]
  periods?: ExpensesPeriod[]
  period?: string
  defaultPeriod?: string
  onPeriodChange?: (period: string) => void
  /** The category held in the middle of the ring (its row pressed), or null. */
  category?: string | null
  defaultCategory?: string | null
  onCategoryChange?: (category: string | null) => void
  /** Called by the ⋯ button. */
  onMoreClick?: () => void
  locale?: string
  currency?: string
}

/** A category's segment: from a0 to a1, in degrees clockwise from 12 o'clock. */
type Arc = { a0: number; a1: number }
/** The ring: each category's segment and where the hatched part starts (360 when there is none). */
type Donut = { arcs: Arc[]; rest: number }

// Figma geometry ("Expenses Chart" 1473:82110): a 320px ring
const SIZE = 320
const CENTER = SIZE / 2
const OUTER = 160
const INNER = 108.8 // 68% of the radius
const CORNER = 8 // Figma's corner radius, measured along each edge from the corner
const GAP = 0.9 // degrees between two categories (Figma's are 1.09° and 0.72°)
const SPREAD = 2 // the inner light's spread: on an arc Figma scales the ellipse by it (to 158 / 160)
// The hatched part: Primary/Orange/orange-50 bars 1.8° wide every 3°, ending at 12 o'clock, 7px inside the ring…
const TICK_INNER = 116.005
const TICK_OUTER = 153
const TICK_SPAN = 1.8
const TICK_STEP = 3
// …inside a 1px orange-300 outline that runs on under the segments next to it
const OUTLINE_BEFORE = 7.62
const OUTLINE_AFTER = 4.75
// The darker core of a segment (Figma's 24-blurred arc in the 600 step, darken): half as wide, 90% as long
const GLOW_INNER = 120.61
const GLOW_OUTER = 147
const GLOW_SHARE = 0.9
const GLOW_CORNER = 7.35
const POP = 4 // a segment pointed at moves this far out
const HOVER_IN = INNER - 10 // the pointer picks a segment from just inside the ring…
const HOVER_OUT = OUTER + 10 // …to just outside it
const SWEEP_AT = 250
const SWEEP = 1300
const MORPH = 800
const FRAME = "M -60 -60 H 380 V 380 H -60 Z " // around the ring: the outside of a shape for its inner light
const REST = "\u0000rest" // the hatched part's key (never a category id)

/** A colour's segment (the 400 step), its 1px rim (500), its core (600, none for yellow, as in Figma) and legend dot. */
const colors: Record<ExpensesColor, { fill: string; rim: string; glow?: string; dot: string; dotRing: string; ring: string }> = {
  orange: {
    fill: "fill-primary-orange-400",
    rim: "fill-primary-orange-500",
    glow: "fill-primary-orange-600",
    dot: "bg-primary-orange-400",
    dotRing: "var(--primary-orange-500)",
    ring: "focus-visible:ring-primary-orange-500/40",
  },
  green: {
    fill: "fill-primary-green-400",
    rim: "fill-primary-green-500",
    glow: "fill-primary-green-600",
    dot: "bg-primary-green-400",
    dotRing: "var(--primary-green-500)",
    ring: "focus-visible:ring-primary-green-500/40",
  },
  yellow: {
    fill: "fill-primary-yellow-400",
    rim: "fill-primary-yellow-500",
    dot: "bg-primary-yellow-400",
    dotRing: "var(--primary-yellow-500)",
    ring: "focus-visible:ring-primary-yellow-500/40",
  },
  blue: {
    fill: "fill-primary-blue-400",
    rim: "fill-primary-blue-500",
    glow: "fill-primary-blue-600",
    dot: "bg-primary-blue-400",
    dotRing: "var(--primary-blue-500)",
    ring: "focus-visible:ring-primary-blue-500/40",
  },
  teal: { fill: "fill-[#5d9292]", rim: "fill-[#3d7575]", glow: "fill-[#2f6060]", dot: "bg-[#5d9292]", dotRing: "#3d7575", ring: "focus-visible:ring-[#3d7575]/40" },
  purple: {
    fill: "fill-primary-purple-400",
    rim: "fill-primary-purple-500",
    glow: "fill-primary-purple-600",
    dot: "bg-primary-purple-400",
    dotRing: "var(--primary-purple-500)",
    ring: "focus-visible:ring-primary-purple-500/40",
  },
}
const PALETTE: ExpensesColor[] = ["orange", "green", "yellow", "blue", "purple"]

const sampleExpensesCategories: ExpensesCategory[] = [
  { id: "debt", label: "Debt", color: "orange" },
  { id: "investment", label: "Investment", color: "green" },
  { id: "asset", label: "Asset", color: "yellow" },
]

// Week is the Figma card: the three segments as long as Figma draws them on a $13,150 weekly budget (the hatched part is
// what is left), adding up to Figma's $8,873.16, up 4.52% on last week. Month and Year are sample periods.
const sampleExpensesPeriods: ExpensesPeriod[] = [
  {
    value: "week",
    label: "Week",
    values: { debt: 2033.29, investment: 3168.13, asset: 3671.74 },
    budget: 13150,
    previous: 8489.45,
    changeLabel: "vs last week",
  },
  {
    value: "month",
    label: "Month",
    values: { debt: 7412.8, investment: 12960.4, asset: 15826.55 },
    budget: 52000,
    previous: 37640.2,
    changeLabel: "vs last month",
  },
  {
    value: "year",
    label: "Year",
    values: { debt: 88640, investment: 151230.6, asset: 186410.25 },
    budget: 600000,
    previous: 398150.3,
    changeLabel: "vs last year",
  },
]

const fixed = (n: number) => Math.round(n * 1000) / 1000
const rad = (degrees: number) => (degrees * Math.PI) / 180
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** A point at radius r and angle a (radians, clockwise from 12 o'clock) around the ring's centre. */
const polar = (r: number, a: number): [number, number] => [CENTER + r * Math.sin(a), CENTER - r * Math.cos(a)]

/** An arc of radius r from a0 to a1 (degrees clockwise from 12 o'clock); a whole circle from 360° on. */
function arcPath(r: number, a0: number, a1: number) {
  if (!(a1 > a0)) return ""
  if (a1 - a0 >= 360) {
    const [x, y] = polar(r, 0)
    const [bx, by] = polar(r, Math.PI)
    return `M ${fixed(x)} ${fixed(y)} A ${r} ${r} 0 1 1 ${fixed(bx)} ${fixed(by)} A ${r} ${r} 0 1 1 ${fixed(x)} ${fixed(y)}`
  }
  const [x0, y0] = polar(r, rad(a0))
  const [x1, y1] = polar(r, rad(a1))
  return `M ${fixed(x0)} ${fixed(y0)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${fixed(x1)} ${fixed(y1)}`
}

/** A wedge from the centre between a0 and a1 (degrees), past the ring's edge; the whole disc from 360° on. */
function wedgePath(a0: number, a1: number) {
  const r = OUTER + 40
  if (!(a1 > a0)) return ""
  if (a1 - a0 >= 360) return `${arcPath(r, 0, 360)} Z`
  return `M ${CENTER} ${CENTER} L ${arcPath(r, a0, a1).slice(2)} Z`
}

/** Where every segment goes: each category's share of the budget (of the total without one), clockwise from 12 o'clock. */
function layoutDonut(values: number[], budget?: number): Donut & { total: number; full: number } {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  const full = budget !== undefined && budget > total ? budget : total
  let at = 0
  const arcs = values.map((value) => {
    const span = full > 0 ? (Math.max(0, value) / full) * 360 : 0
    const arc = { a0: at, a1: Math.max(at, at + span - GAP) }
    at += span
    return arc
  })
  // the hatched part starts where the last segment ends
  const rest = full > total ? (arcs.length ? arcs[arcs.length - 1].a1 : 0) : 360
  return { arcs, rest, total, full }
}

/** A segment's shapes: its 1px rim, its fill, the outside of its inner light and its core. */
function segmentShapes({ a0, a1 }: Arc) {
  if (!(a1 - a0 > 0.01)) return { rim: "", fill: "", light: "", glow: "" }
  const shrink = (OUTER - SPREAD) / OUTER
  const mid = (a0 + a1) / 2
  const half = ((a1 - a0) * GLOW_SHARE) / 2
  return {
    // Figma's 1px ring (a drop shadow with a spread of 1) scales the arc 1px outward: it shows past the outer edge only
    // (its inner edge is 0.7px under the segment's, so that edge isn't anti-aliased twice)
    rim: sectorPath((INNER * (OUTER + 1)) / OUTER, OUTER + 1, rad(a0), rad(a1), { center: CENTER, corner: (CORNER * (OUTER + 1)) / OUTER }),
    fill: sectorPath(INNER, OUTER, rad(a0), rad(a1), { center: CENTER, corner: CORNER }),
    // the inner light is blurred from outside the segment scaled 2px in: 2px in along the outer edge, 1.4px out along
    // the inner one (so it is fainter there) and none along the ends
    light: FRAME + sectorPath(INNER * shrink, OUTER * shrink, rad(a0), rad(a1), { center: CENTER, corner: CORNER * shrink }),
    glow: sectorPath(GLOW_INNER, GLOW_OUTER, rad(mid - half), rad(mid + half), { center: CENTER, corner: GLOW_CORNER }),
  }
}

/** The hatched part's clip (its bars from the one under the last segment's end) and its outline. */
function restShapes(rest: number) {
  return {
    bars: rest < 360 ? wedgePath(Math.max(0, rest - TICK_SPAN), 360) : "",
    outerLine: rest < 360 ? arcPath(OUTER - 0.5, rest - OUTLINE_BEFORE, 360 + OUTLINE_AFTER) : "",
    innerLine: rest < 360 ? arcPath(INNER + 0.5, rest - OUTLINE_BEFORE, 360 + OUTLINE_AFTER) : "",
  }
}

// the hatched part's bars, every 3° around the ring, each ending on a multiple of 3° (the last at 12 o'clock)
const TICKS = Array.from({ length: 360 / TICK_STEP }, (_, k) => {
  const end = 360 - k * TICK_STEP
  return { end, d: sectorPath(TICK_INNER, TICK_OUTER, rad(end - TICK_SPAN), rad(end), { center: CENTER, corner: 0 }) }
})

/** Sets every shape of the ring to `donut` (React renders the same shapes; this draws the in-between frames). */
function drawDonut(root: Element | null, donut: Donut) {
  if (!root) return
  root.querySelectorAll<SVGGElement>("[data-arc]").forEach((group) => {
    const arc = donut.arcs[Number(group.dataset.arc)]
    const shapes = arc ? segmentShapes(arc) : segmentShapes({ a0: 0, a1: 0 })
    group.querySelectorAll("[data-shape]").forEach((node) => node.setAttribute("d", shapes[node.getAttribute("data-shape") as keyof typeof shapes] ?? ""))
  })
  const rest = restShapes(donut.rest)
  root.querySelectorAll("[data-rest]").forEach((node) => node.setAttribute("d", rest[node.getAttribute("data-rest") as keyof typeof rest] ?? ""))
}

/** The ring part of the way from `from` to `to`; categories that come in grow from where their segment starts. */
const lerpDonut = (from: Donut, to: Donut, t: number): Donut => ({
  arcs: to.arcs.map((arc, i) => {
    const start = from.arcs[i] ?? { a0: arc.a0, a1: arc.a0 }
    return { a0: lerp(start.a0, arc.a0, t), a1: lerp(start.a1, arc.a1, t) }
  }),
  rest: lerp(from.rest, to.rest, t),
})

/** The ring swept round to `sweep` degrees: every segment cut there, the hatched part as it will be. */
const sweptDonut = (donut: Donut, sweep: number): Donut => ({
  arcs: donut.arcs.map(({ a0, a1 }) => ({ a0, a1: Math.max(a0, Math.min(a1, sweep)) })),
  rest: donut.rest,
})

/** The 10px legend dot: the colour in a 0.7px ring, a soft drop shadow, a faint inner shadow and a white top edge. */
function Dot({ color }: { color: ExpensesColor }) {
  const gradient = `asset-overview-dot-${React.useId().replace(/[^\w-]/g, "")}`
  return (
    <span
      aria-hidden
      data-slot="expenses-chart-dot"
      className={cn("relative size-2.5 shrink-0 rounded-full", colors[color].dot)}
      // Figma paints later effects on top; CSS paints the first shadow on top
      style={{ boxShadow: `0 5.142px 10.284px -2.571px rgb(38 45 58 / 0.2), 0 0 0 0.714px ${colors[color].dotRing}, inset 0 -2.571px 5.142px -2.571px rgb(0 0 0 / 0.05)` }}
    >
      {/* Figma: a 0.71px inside stroke, white at 24% fading out toward the bottom */}
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity={0.24} />
            <stop offset="1" stopColor="#fff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <circle cx="5" cy="5" r="4.643" fill="none" stroke={`url(#${gradient})`} strokeWidth={0.714} />
      </svg>
    </span>
  )
}

/** A category's row: its dot, name and amount; pressing it holds the category in the middle of the ring. */
function CategoryRow({
  category,
  color,
  value,
  pressed,
  dimmed,
  onToggle,
  onPreview,
  format,
}: {
  category: ExpensesCategory
  color: ExpensesColor
  value: number
  pressed: boolean
  dimmed: boolean
  onToggle: () => void
  onPreview: (on: boolean) => void
  format: (value: number) => string
}) {
  const valueRef = React.useRef<HTMLSpanElement>(null)
  useCountUp(valueRef, value, format, { duration: 900 })
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-slot="expenses-chart-category"
      onClick={onToggle}
      onPointerEnter={(event) => event.pointerType === "mouse" && onPreview(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && onPreview(false)}
      className={cn(
        // Figma "Header Cell": Background/Disable inside a 1px Border/Soft ring, 16 × 13px from the outer edge
        "flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-xl border border-border-soft bg-surface-disable px-3 py-[15px] text-left outline-none",
        "transition-[background-color,box-shadow,opacity] duration-200 hover:bg-surface-base focus-visible:ring-2 motion-reduce:transition-none",
        pressed && "bg-surface-white shadow-[0_1px_2px_rgb(40_40_40/0.08)] hover:bg-surface-white",
        dimmed && "opacity-50",
        colors[color].ring,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Dot color={color} />
        {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
        <span className="typo-label-02-medium -my-0.5 min-w-0 truncate py-0.5 text-fg-normal">{category.label}</span>
      </span>
      <span ref={valueRef} data-slot="expenses-chart-category-value" className="typo-label-02-medium hug-w shrink-0 whitespace-nowrap text-fg-loud">
        {format(value)}
      </span>
    </button>
  )
}

/**
 * "Expenses Chart" from the Keitoto library: the period's total with its change, a Week / Month / Year switch, a row per
 * category with its amount and a ring of the categories on the period's budget: Debt, Investment and Asset in orange,
 * green and yellow, clockwise from 12 o'clock, and what is left of the budget hatched in pale orange. Pointing at a
 * segment or a row (or the hatched part) brings it forward and shows it in the middle of the ring; pressing a row holds
 * it there. Animated with anime.js: the total counts up and its badge pops, the rows rise in, the segments sweep round
 * from 12 o'clock with their dark cores coming up after them and the hatching fills in; another period turns every
 * segment to its new size while the numbers count.
 */
function ExpensesChart({
  title = "Expenses",
  totalLabel = "Total Expenses",
  remainingLabel = "Left to spend",
  categories = sampleExpensesCategories,
  periods = sampleExpensesPeriods,
  period: periodProp,
  defaultPeriod,
  onPeriodChange,
  category: categoryProp,
  defaultCategory = null,
  onCategoryChange,
  onMoreClick,
  locale = "en-US",
  currency = "USD",
  className,
  ...props
}: ExpensesChartProps) {
  const [periodValue, setPeriod] = useControllableState({ value: periodProp, defaultValue: defaultPeriod ?? periods[0]?.value ?? "", onChange: onPeriodChange })
  const period = periods.find((p) => p.value === periodValue) ?? periods[0]
  const [pinned, setPinned] = useControllableState<string | null>({ value: categoryProp, defaultValue: defaultCategory, onChange: onCategoryChange })
  const [preview, setPreview] = React.useState<string | null>(null)
  const values = categories.map((c) => Math.max(0, period?.values[c.id] ?? 0))
  const donut = React.useMemo(() => layoutDonut(categories.map((c) => period?.values[c.id] ?? 0), period?.budget), [categories, period])
  const { total, full } = donut
  const remaining = full > total ? full - total : 0
  const previous = period?.previous
  const change = previous !== undefined && previous > 0 ? ((total - previous) / previous) * 100 : undefined
  const colorOf = (c: ExpensesCategory, i: number) => c.color ?? PALETTE[i % PALETTE.length]
  const layoutKey = `${donut.arcs.map((a) => `${fixed(a.a0)}-${fixed(a.a1)}`).join(",")}|${fixed(donut.rest)}`

  // what is in the middle of the ring: the row or segment pointed at, else the pressed row
  const shownKey = preview ?? pinned
  const shownIndex = categories.findIndex((c) => c.id === shownKey)
  const shownRest = shownKey === REST && remaining > 0
  const shown = shownIndex >= 0 ? { label: categories[shownIndex].label, value: values[shownIndex], note: total > 0 ? values[shownIndex] / total : 0 } : undefined

  const money = React.useCallback((value: number) => formatCurrency(value, { locale, currency }), [locale, currency])
  const percent = React.useCallback((value: number) => formatPercent(Math.abs(value), { locale, minimumFractionDigits: 2, maximumFractionDigits: 2 }), [locale])

  const reduced = useReducedMotion()
  const root = React.useRef<HTMLDivElement>(null)
  const ringRef = React.useRef<SVGSVGElement>(null)
  const totalRef = React.useRef<HTMLParagraphElement>(null)
  const changeRef = React.useRef<HTMLSpanElement>(null)
  const centerRef = React.useRef<HTMLDivElement>(null)
  const centerValueRef = React.useRef<HTMLSpanElement>(null)
  const ids = React.useId().replace(/[^\w-]/g, "")
  const totalText = money(total)
  const centerValue = shown ? shown.value : shownRest ? remaining : 0
  // what the entrance's callbacks need at play time
  const latest = React.useRef({ donut, total, totalText })
  useIsomorphicLayoutEffect(() => {
    latest.current = { donut, total, totalText }
  })
  const all = (selector: string) => Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])

  // What is on screen, so a change animates from there; the entrance's sweep (null without one), so a redraw before it
  // is done keeps the segments where it has them.
  const drawn = React.useRef<Donut | null>(null)
  const sweeping = React.useRef<{ t: number } | null>(null)
  const morph = React.useRef<JSAnimation | null>(null)

  // New values count from the previous ones.
  useCountUp(totalRef, total, money, { duration: 900 })
  useCountUp(changeRef, change ?? 0, percent, { duration: 900 })
  useCountUp(centerValueRef, centerValue, money, { duration: 500 })

  // Entrance, once the card is in view: the total counts up and the badge pops, the rows rise in, the segments sweep
  // round from 12 o'clock and their cores come up after them, and the hatched part fills in from where it starts.
  useChartEntrance(root, (timeline) => {
    const ring = ringRef.current
    const sweep = { t: 0 }
    sweeping.current = sweep
    const draw = () => drawDonut(ring, sweptDonut(latest.current.donut, sweep.t * 360))
    draw()
    timeline.add(sweep, { t: [0, 1], duration: SWEEP, ease: "inOutCubic", onUpdate: draw }, SWEEP_AT)
    const glows = all('[data-slot="expenses-chart-core"]')
    if (glows.length) timeline.add(glows, { opacity: { from: 0 }, duration: 700, ease: "outQuad", delay: stagger(140) }, SWEEP_AT + SWEEP * 0.45)
    // the bars come in clockwise from the hatched part's start
    const rest = latest.current.donut.rest
    const bars = all('[data-slot="expenses-chart-bar"]')
    const span = Math.max(1, 360 - rest)
    const delays = bars.map((bar) => (Math.max(0, Number(bar.dataset.end) - rest) / span) * 600)
    if (bars.length) timeline.add(bars, { opacity: { from: 0 }, duration: 350, ease: "outQuad", delay: (_, i) => delays[i ?? 0] ?? 0 }, SWEEP_AT + SWEEP * 0.55)
    const lines = all('[data-slot="expenses-chart-outline"]')
    if (lines.length) timeline.add(lines, { opacity: { from: 0 }, duration: 600, ease: "outQuad" }, SWEEP_AT + SWEEP * 0.5)
    const totalEl = totalRef.current
    const counter = { t: 0 }
    const count = () => {
      if (totalEl) totalEl.textContent = money(latest.current.total * counter.t)
    }
    count()
    timeline
      .add(counter, { t: [0, 1], duration: 1400, ease: "outExpo", onUpdate: count }, 100)
      .add(all('[data-slot="chart-change-badge"]'), { opacity: { from: 0 }, scale: { from: 0.6 }, duration: 600, ease: "outBack(2)" }, 500)
      .add(all('[data-slot="expenses-chart-change-label"]'), { opacity: { from: 0 }, translateX: { from: -4 }, duration: 500, ease: "outQuad" }, 600)
      .add(
        all('[data-slot="expenses-chart-category"]'),
        // handed back to the rows' classes after, which dim them while another category is shown
        { opacity: { from: 0 }, translateY: { from: 10 }, duration: 800, ease: "outExpo", delay: stagger(90), onComplete: releaseStyles("opacity", "transform") },
        350,
      )
    timeline.call(() => {
      if (sweeping.current === sweep) sweeping.current = null
    })
    return () => {
      if (sweeping.current === sweep) sweeping.current = null
      sweep.t = 1
      draw()
      if (totalEl) totalEl.textContent = latest.current.totalText
    }
  })

  // Another period (or new data) turns every segment from its size on screen to the new one (and the hatched part
  // with them); during the entrance the sweep goes on with the new sizes.
  const lastLayout = React.useRef(layoutKey)
  useIsomorphicLayoutEffect(() => {
    const before = lastLayout.current
    lastLayout.current = layoutKey
    const from = drawn.current ?? donut
    drawn.current = donut
    if (before === layoutKey) return
    const ring = ringRef.current
    morph.current?.cancel()
    morph.current = null
    const sweep = sweeping.current
    if (sweep) {
      drawDonut(ring, sweptDonut(donut, sweep.t * 360))
      return
    }
    if (reduced) {
      drawDonut(ring, donut)
      return
    }
    const state = { t: 0 }
    const frame = () => {
      const now = lerpDonut(from, donut, state.t)
      drawn.current = now
      drawDonut(ring, now)
    }
    frame()
    morph.current = animate(state, {
      t: 1,
      duration: MORPH,
      ease: "outExpo",
      onUpdate: frame,
      onComplete: () => {
        morph.current = null
        drawn.current = donut
        drawDonut(ring, donut)
      },
    })
  }, [layoutKey, reduced])
  React.useEffect(
    () => () => {
      morph.current?.cancel()
    },
    [],
  )

  // The segment pointed at moves out a little (and back when it isn't any more); the middle pops in when something is
  // shown there.
  const lastShown = React.useRef(shownIndex)
  useIsomorphicLayoutEffect(() => {
    const before = lastShown.current
    lastShown.current = shownIndex
    if (reduced || before === shownIndex) return
    const groups = (i: number) => Array.from(ringRef.current?.querySelectorAll<SVGGElement>(`[data-pop="${i}"]`) ?? [])
    const offset = (i: number) => {
      const arc = donut.arcs[i]
      if (!arc) return [0, 0]
      const mid = rad((arc.a0 + arc.a1) / 2)
      return [POP * Math.sin(mid), -POP * Math.cos(mid)]
    }
    if (before >= 0) {
      const els = groups(before)
      if (els.length) animate(els, { translateX: 0, translateY: 0, duration: 400, ease: "outExpo" })
    }
    if (shownIndex >= 0) {
      const [x, y] = offset(shownIndex)
      const els = groups(shownIndex)
      if (els.length) animate(els, { translateX: x, translateY: y, duration: 500, ease: "outBack(1.6)" })
    }
  }, [shownIndex, reduced])
  const centerKey = shown ? `c${shownIndex}` : shownRest ? "rest" : ""
  const lastCenter = React.useRef(centerKey)
  useIsomorphicLayoutEffect(() => {
    const before = lastCenter.current
    lastCenter.current = centerKey
    const el = centerRef.current
    if (!el || reduced || before === centerKey || !centerKey) return
    animate(el, { opacity: [0, 1], scale: [0.92, 1], duration: 350, ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
  }, [centerKey, reduced])

  /** The category (or the hatched part) under the pointer, by its angle round the ring. */
  const pointAt = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.currentTarget
    const box = target.getBoundingClientRect()
    // CSS zoom (the live demo scales wide demos down) scales the box but not the layout
    const zoom = box.width / (target.offsetWidth || box.width || 1) || 1
    const x = (event.clientX - box.left) / zoom - CENTER
    const y = (event.clientY - box.top) / zoom - CENTER
    const r = Math.hypot(x, y)
    if (r < HOVER_IN || r > HOVER_OUT) return null
    const angle = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360
    let at = 0
    for (let i = 0; i < categories.length; i++) {
      const span = full > 0 ? (values[i] / full) * 360 : 0
      if (span > 0 && angle >= at && angle < at + span) return categories[i].id
      at += span
    }
    return remaining > 0 ? REST : null
  }
  const toggle = (id: string) => setPinned(pinned === id ? null : id)
  const percentOf = (part: number) => formatPercent(part * 100, { locale, maximumFractionDigits: 1 })
  const describe = (c: ExpensesCategory, i: number) => `${c.label}: ${money(values[i])}${total > 0 ? `, ${percentOf(values[i] / total)} of ${money(total)}` : ""}`
  // glowing segments first, their cores over them, then the segments without a core (Figma draws yellow last)
  const order = categories.map((c, i) => ({ c, i, color: colorOf(c, i) }))
  const cored = order.filter((o) => colors[o.color].glow)
  const flat = order.filter((o) => !colors[o.color].glow)
  const restShape = restShapes(donut.rest)

  const segment = ({ c, i, color }: (typeof order)[number]) => {
    const shapes = segmentShapes(donut.arcs[i])
    return (
      <g key={c.id} data-pop={i} className={cn("transition-opacity duration-200 motion-reduce:transition-none", shownKey !== null && shownKey !== c.id && "opacity-35")}>
        <g data-arc={i}>
          <path data-shape="rim" d={shapes.rim} className={colors[color].rim} />
          <path data-shape="fill" d={shapes.fill} className={colors[color].fill} />
          <clipPath id={`${ids}-segment-${i}`}>
            <path data-shape="fill" d={shapes.fill} />
          </clipPath>
          {/* Figma's inner shadow: white at 32%, blur 6, spread 2 */}
          <g clipPath={`url(#${ids}-segment-${i})`}>
            <path data-shape="light" d={shapes.light} fillRule="evenodd" fill="#fff" fillOpacity={0.32} filter={`url(#${ids}-light)`} />
          </g>
        </g>
      </g>
    )
  }

  return (
    <ChartCard ref={root} role="group" aria-label={title} className={cn("w-full", className)} {...props}>
      <div className="flex items-center justify-between gap-4">
        {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
        <p className="typo-heading-01-semibold -my-0.5 min-w-0 flex-1 truncate py-0.5 text-fg-loud">{title}</p>
        {onMoreClick && <ChartButton size="icon" corner="rounded" aria-label="More options" onClick={onMoreClick} className="focus-visible:ring-primary-orange-500/40">
          <DotsHorizontalIcon />
        </ChartButton>}
      </div>

      <div data-slot="expenses-chart-summary" className="flex items-center gap-2.5">
        <div className="flex min-w-0 flex-1 items-end gap-2.5">
          <div className="flex shrink-0 flex-col items-start gap-2.5">
            <p className="typo-label-03-medium hug-w whitespace-nowrap text-fg-normal">{totalLabel}</p>
            <p ref={totalRef} data-slot="expenses-chart-total" className="typo-heading-04-semibold hug-w whitespace-nowrap text-fg-loud">
              {totalText}
            </p>
          </div>
          {change !== undefined && (
            <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
              <ChartChangeBadge value={change} format={percent} valueRef={changeRef} />
              {period?.changeLabel && (
                <span data-slot="expenses-chart-change-label" className="typo-label-02-medium hug-w min-w-0 truncate text-fg-soft">
                  {period.changeLabel}
                </span>
              )}
            </div>
          )}
        </div>
        {periods.length > 1 && (
          <ChartSegmentedControl
            aria-label="Period"
            variant="rounded"
            size="fit"
            items={periods.map((p) => ({ value: p.value, label: p.label }))}
            value={period?.value}
            onValueChange={(next) => {
              setPreview(null)
              setPeriod(next)
            }}
            className="shrink-0"
          />
        )}
      </div>

      <div data-slot="expenses-chart-body" className="flex items-end gap-10">
        <div role="group" aria-label={`${title} by category`} className="flex min-w-0 flex-1 flex-col gap-3">
          {categories.map((c, i) => (
            <CategoryRow
              key={c.id}
              category={c}
              color={colorOf(c, i)}
              value={values[i]}
              pressed={pinned === c.id}
              dimmed={shownKey !== null && shownKey !== c.id}
              onToggle={() => toggle(c.id)}
              onPreview={(on) => setPreview(on ? c.id : null)}
              format={money}
            />
          ))}
        </div>

        <div
          role="img"
          aria-label={`${categories.map(describe).join("; ")}${remaining > 0 ? `; ${remainingLabel}: ${money(remaining)} of ${money(full)}` : ""}`}
          data-slot="expenses-chart-ring"
          className="relative size-80 shrink-0 touch-pan-y"
          onPointerMove={(event) => setPreview(pointAt(event))}
          onPointerLeave={() => setPreview(null)}
          onPointerUp={(event) => {
            if (event.button !== 0) return
            const id = pointAt(event)
            if (id && id !== REST) toggle(id)
          }}
        >
          <svg ref={ringRef} aria-hidden viewBox={`0 0 ${SIZE} ${SIZE}`} className="pointer-events-none absolute inset-0 size-full overflow-visible">
            <defs>
              {/* Figma's blurs are Gaussians with a standard deviation of 0.45 × their radius: the inner shadow's 6, the cores' 24 */}
              <filter id={`${ids}-light`} filterUnits="userSpaceOnUse" x={-60} y={-60} width={SIZE + 120} height={SIZE + 120} colorInterpolationFilters="sRGB">
                <feGaussianBlur stdDeviation={2.7} />
              </filter>
              <filter id={`${ids}-core`} filterUnits="userSpaceOnUse" x={-60} y={-60} width={SIZE + 120} height={SIZE + 120} colorInterpolationFilters="sRGB">
                <feGaussianBlur stdDeviation={10.8} />
              </filter>
              <clipPath id={`${ids}-rest`}>
                <path data-rest="bars" d={restShape.bars} />
              </clipPath>
            </defs>

            {/* what is left of the budget: pale orange bars inside a 1px orange-300 outline */}
            <g className={cn("transition-opacity duration-200 motion-reduce:transition-none", shownKey !== null && !shownRest && "opacity-50")}>
              <g clipPath={`url(#${ids}-rest)`} className="fill-primary-orange-50">
                {TICKS.map((tick) => (
                  <path key={tick.end} data-slot="expenses-chart-bar" data-end={tick.end} d={tick.d} />
                ))}
              </g>
              <path data-slot="expenses-chart-outline" data-rest="outerLine" d={restShape.outerLine} fill="none" className="stroke-primary-orange-300" />
              <path data-slot="expenses-chart-outline" data-rest="innerLine" d={restShape.innerLine} fill="none" className="stroke-primary-orange-300" />
            </g>

            {cored.map(segment)}
            {/* the cores: each segment's colour at 600, blurred and darkening what is under it (also around the ring) */}
            {cored.map(({ c, i, color }) => (
              <g key={c.id} data-pop={i} className={cn("transition-opacity duration-200 motion-reduce:transition-none", shownKey !== null && shownKey !== c.id && "opacity-35")}>
                <g data-arc={i} data-slot="expenses-chart-core" className="mix-blend-darken">
                  <path data-shape="glow" d={segmentShapes(donut.arcs[i]).glow} className={colors[color].glow} filter={`url(#${ids}-core)`} />
                </g>
              </g>
            ))}
            {flat.map(segment)}
          </svg>

          {/* the middle: what is pointed at (or pressed), its amount and its share */}
          <div
            ref={centerRef}
            aria-hidden
            data-slot="expenses-chart-center"
            className={cn("pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5", !shown && !shownRest && "opacity-0")}
          >
            <span className="typo-label-02-medium hug-w whitespace-nowrap text-fg-normal">{shown ? shown.label : shownRest ? remainingLabel : ""}</span>
            <span ref={centerValueRef} className="typo-heading-01-semibold hug-w whitespace-nowrap text-fg-loud">
              {money(centerValue)}
            </span>
            <span className="typo-label-02-medium hug-w whitespace-nowrap text-fg-soft">
              {shown ? `${percentOf(shown.note)} of ${money(total)}` : shownRest ? `of ${money(full)}` : ""}
            </span>
          </div>
        </div>
      </div>
    </ChartCard>
  )
}

export { ExpensesChart, sampleExpensesCategories, sampleExpensesPeriods, type ExpensesCategory, type ExpensesChartProps, type ExpensesColor, type ExpensesPeriod }