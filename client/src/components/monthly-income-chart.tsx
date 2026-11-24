"use client"
// Mebius charts-monthly-income, retrieved with get_item on 2026-11-21.
// Attribution adaptation: arc = absolute magnitude; signed labels = root net delta.
import { money, signedMoney, share as shareLabel } from '../../../shared/format';
import { DivergingBar } from './system/DivergingBar';

import { animate, stagger, type JSAnimation } from "animejs"
import * as React from "react"

import { ChartButton } from "@/components/ui/chart-button"
import { ChartCard } from "@/components/ui/chart-card"
import { ArrowUpRightIcon, DotsHorizontalIcon } from "@/components/ui/chart-icons"
import { useChartEntrance, useCountUp, useIsomorphicLayoutEffect, useReducedMotion } from "@/hooks/use-chart-motion"
import { useChartSize } from "@/hooks/use-chart-size"
import { useControllableState } from "@/hooks/use-controllable-state"
import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/chart-format"
import { cn } from "@/lib/utils"

type MonthlyIncomeSource = {
  id: string
  label: string
  /** The month's income from this source, shown with its sign ("+$2,100"). */
  amount: number
  /** A 20px logo or icon before the label. */
  kind?: "factor"|"residual"|"revenue"
  icon?: React.ReactNode
}

type MonthlyIncomeChartProps = Omit<React.ComponentProps<"div">, "children"> & {
  netDelta?: number
  summaryLabel?: string
  title?: string
  /** The month's income in the middle of the gauge; the sum of the sources by default. */
  value?: number
  /** The monthly target: the gauge is full, and the percentage reads 100%, at this amount. */
  target?: number
  /** The text after the percentage. */
  targetLabel?: string
  /** The list's heading and the line under it. */
  sourcesTitle?: string
  sourcesDescription?: string
  sources?: MonthlyIncomeSource[]
  /** The source the gauge shows (an index into `sources`), or null for the whole month. Hover and focus preview one. */
  index?: number | null
  initialVisibleSources?: number
  defaultIndex?: number | null
  onIndexChange?: (index: number | null, source: MonthlyIncomeSource | undefined) => void
  onSourceActivate?: (source: MonthlyIncomeSource) => void
  /** The button under the list. */
  insightLabel?: string
  onInsightClick?: () => void
  /** Called by the ⋯ button. */
  onMoreClick?: () => void
  locale?: string
  currency?: string
}

// Figma geometry ("Monthly Income Chart" 1473:81484). The gauge is the top of a 704px circle: angles are in degrees,
// clockwise from 3 o'clock (y points down), and positions are in the gauge's box (the card's content width).
const GAUGE_WIDTH = 378
const GAUGE_HEIGHT = 182 // the "Value Group" frame: the gauge is cut off at its bottom
const PAD = 20 // the card's padding: the track runs on into it, up to the card's edges, which cut it off
const CENTRE_X = -7.398 // the circle's centre, 7.4px left of the middle…
const CENTRE_Y = 379.595 // …and under the gauge's top (between Figma's two arcs, whose circles are 2px apart)
const RADIUS = 343.808 // the middle of the track (the arcs run from 335.31 to 352.305)
const TRACK = 16.995 // the arcs' width
const CAP = 1.416 // a round cap's half-width in degrees: the cap's tip ends on the arc's end, like Figma's corners
const GAP = 3.25 // degrees of track between the dot's centre and each arc's tip (34px)
const DOT = 12 // the dot's radius…
const RING = 3.5 // …and its ring's width, inside it
const EDGE = 4 // at 0% and 100% the dot stays this far inside the card
const TOP = 270 // the arcs and their gradients are laid out for the dot at the top of the circle, then turned to it
const REACH = 120 // how far each arc runs on from the dot (the card cuts it off)
// Figma's gradients, relative to the circle's centre with the dot at the top: green-500 fading out toward the start of
// the gauge and Background/Subdued fading out toward its end. Both turn with the dot, so the arcs are always solid next
// to it.
const GREEN_FADE = { x1: -8.454, y1: -352.204, x2: -254.851, y2: -165.714 }
const GREY_FADE = { x1: 65.865, y1: -346.094, x2: 254.25, y2: -116.798 }
const TEXT_TOP = 106 // the amount and the percentage, centred under the dot
const SWEEP = 1500 // the entrance's sweep along the track
const MORPH = 750
const RING_FOCUS = "focus-visible:ring-[var(--accent)]" // the card's focus rings are green

const round = (n: number) => Math.round(n * 1000) / 1000
const rad = (deg: number) => (deg * Math.PI) / 180

/** Dribbble's ball (Figma "dribbble", 20px). */
function DribbbleLogo(props: React.ComponentProps<"svg">) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden data-slot="logo" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M18.75 10C18.75 14.8325 14.8325 18.75 10 18.75C5.16751 18.75 1.25 14.8325 1.25 10C1.25 5.16751 5.16751 1.25 10 1.25C14.8325 1.25 18.75 5.16751 18.75 10ZM13.0775 16.8416C12.1385 17.2646 11.0967 17.5 10 17.5C8.18942 17.5 6.52869 16.8584 5.23275 15.7902C6.5809 13.5279 8.74928 11.8127 11.3269 11.0538C12.0672 12.9113 12.6559 14.8457 13.0775 16.8416ZM14.2179 16.2024C13.8026 14.3345 13.2456 12.5199 12.559 10.7705C13.1306 10.6748 13.7177 10.625 14.3164 10.625C15.3979 10.625 16.4404 10.7873 17.4216 11.0885C17.113 13.2114 15.915 15.0461 14.2179 16.2024ZM17.4976 9.80832C16.4849 9.52587 15.4178 9.375 14.3164 9.375C13.5486 9.375 12.7979 9.44824 12.071 9.58809C11.8814 9.1505 11.6836 8.71732 11.4777 8.28873C13.114 7.56242 14.6262 6.60738 15.9736 5.46431C16.8954 6.67651 17.4567 8.17779 17.4976 9.80832ZM15.1366 4.53508C13.8717 5.60364 12.4523 6.49472 10.9167 7.17004C10.1061 5.61991 9.18856 4.13458 8.17399 2.72385C8.7585 2.57763 9.37018 2.5 10 2.5C11.9876 2.5 13.7946 3.27314 15.1366 4.53508ZM6.93908 3.15101C4.73734 4.1365 3.09754 6.1525 2.63319 8.58552C3.05986 8.61687 3.49091 8.63283 3.92579 8.63283C5.96824 8.63283 7.92816 8.28074 9.74838 7.63385C8.92165 6.06696 7.9816 4.56905 6.93908 3.15101ZM2.50191 9.8292C2.50064 9.88598 2.5 9.94292 2.5 10C2.5 11.87 3.1844 13.5802 4.31638 14.8937C5.80752 12.5308 8.11375 10.7325 10.8408 9.89446C10.6724 9.51205 10.4975 9.13316 10.3162 8.75792C8.32298 9.48568 6.17061 9.88283 3.92579 9.88283C3.44683 9.88283 2.97198 9.86474 2.50191 9.8292Z"
        fill="#E84C88"
      />
    </svg>
  )
}

/** LinkedIn's "in" on its blue circle (Figma "linkedin", 20px). */
function LinkedInLogo(props: React.ComponentProps<"svg">) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden data-slot="logo" {...props}>
      <rect x="1.25" y="1.25" width="17.5" height="17.5" rx="8.75" fill="#1275B1" />
      <path d="M7.8866 6.05759C7.8866 6.64169 7.38032 7.11519 6.7558 7.11519C6.13128 7.11519 5.625 6.64169 5.625 6.05759C5.625 5.4735 6.13128 5 6.7558 5C7.38032 5 7.8866 5.4735 7.8866 6.05759Z" fill="#fff" />
      <path d="M5.77964 7.89256H7.71263V13.75H5.77964V7.89256Z" fill="#fff" />
      <path
        d="M10.8247 7.89256H8.89175V13.75H10.8247C10.8247 13.75 10.8247 11.906 10.8247 10.753C10.8247 10.061 11.061 9.36596 12.0039 9.36596C13.0694 9.36596 13.063 10.2716 13.058 10.9732C13.0515 11.8903 13.067 12.8262 13.067 13.75H15V10.6586C14.9836 8.68461 14.4693 7.77505 12.7771 7.77505C11.7721 7.77505 11.1492 8.23129 10.8247 8.64406V7.89256Z"
        fill="#fff"
      />
    </svg>
  )
}

/** Adobe's "A" on its red tile (Figma "adobe", 20px). */
function AdobeLogo(props: React.ComponentProps<"svg">) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden data-slot="logo" {...props}>
      <path
        d="M1.25 7.58333C1.25 5.36646 1.25 4.25802 1.68143 3.41129C2.06093 2.66648 2.66648 2.06093 3.41129 1.68143C4.25802 1.25 5.36646 1.25 7.58333 1.25H12.4167C14.6335 1.25 15.742 1.25 16.5887 1.68143C17.3335 2.06093 17.9391 2.66648 18.3186 3.41129C18.75 4.25802 18.75 5.36646 18.75 7.58333V12.4167C18.75 14.6335 18.75 15.742 18.3186 16.5887C17.9391 17.3335 17.3335 17.9391 16.5887 18.3186C15.742 18.75 14.6335 18.75 12.4167 18.75H7.58333C5.36646 18.75 4.25802 18.75 3.41129 18.3186C2.66648 17.9391 2.06093 17.3335 1.68143 16.5887C1.25 15.742 1.25 14.6335 1.25 12.4167V7.58333Z"
        fill="#E6001F"
      />
      <path
        d="M4.375 14.375C4.375 14.375 8.26293 5.00245 8.2537 5H8.25369C8.25369 5 8.2537 5 8.2537 5H11.2063L15.625 14.375L12.2876 14.375C12.29 14.38 9.78516 8.62268 9.75376 8.56481C9.74828 8.61501 8.09275 12.4682 8.07276 12.4729H9.85689C9.84878 12.4827 10.6326 14.3571 10.6326 14.375L4.375 14.375Z"
        fill="#fff"
      />
    </svg>
  )
}

// The Figma card: three sources making $3,900 in the month. Figma draws the dot halfway along the gauge, so the
// sample's target is twice that.
const sampleMonthlyIncomeSources: MonthlyIncomeSource[] = [
  { id: "freelance", label: "UI/UX Freelance Project", amount: 2100, icon: <DribbbleLogo /> },
  { id: "retainer", label: "Retainer Design Studio", amount: 1250, icon: <LinkedInLogo /> },
  { id: "assets", label: "Digital Asset Sales", amount: 550, icon: <AdobeLogo /> },
]
const SAMPLE_TARGET = 7800

/**
 * Where the gauge sits at a width: the circle's centre, and the dot's angles at 0% and 100%, where it is EDGE inside
 * the card's left and right edges.
 */
function gaugeLayout(width: number) {
  const cx = width / 2 + CENTRE_X
  // the angle on the circle's upper half where the dot's centre is at x
  const angleAt = (x: number) => 360 - (Math.acos(Math.min(1, Math.max(-1, (x - cx) / RADIUS))) * 180) / Math.PI
  return { cx, cy: CENTRE_Y, from: Math.max(200, angleAt(DOT + EDGE)), to: Math.min(340, angleAt(width - DOT - EDGE)) }
}

/** The track's middle from one angle to another, clockwise. */
function arcPath(cx: number, cy: number, from: number, to: number) {
  const point = (angle: number) => `${round(cx + RADIUS * Math.cos(rad(angle)))} ${round(cy + RADIUS * Math.sin(rad(angle)))}`
  return `M ${point(from)} A ${RADIUS} ${RADIUS} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}`
}

/** A ring between two radii around (0, 0), as a filled path (Chrome draws thick SVG strokes slightly off Figma's). */
function ringPath(outer: number, inner: number) {
  const circle = (r: number) => `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z`
  return `${circle(outer)} ${circle(inner)}`
}
const DOT_RING = ringPath(DOT, DOT - RING)

/** A source's amount, counting from the previous one when it changes. */
function SourceAmount({ value, format }: { value: number; format: (value: number) => string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useCountUp(ref, value, format, { duration: 600 })
  return (
    <span ref={ref} data-slot="monthly-income-chart-amount" data-value={value} className="typo-label-02-medium hug-w shrink-0 whitespace-nowrap">
      {format(value)}
    </span>
  )
}

/**
 * "Monthly Income Chart" from the Keitoto library: the month's income on a wide gauge, the green arc running up to a
 * ringed dot at its share of the monthly target and the rest of the track grey, with the amount and the percentage of
 * the target under it; below, the income sources with their logos and amounts, and a "See insight" button. Hover or
 * focus a source to see it alone on the gauge, click to keep it there. Animated with anime.js: the track fades in and
 * the dot sweeps along it to the month's share while the green arc grows behind it and the numbers count up, then the
 * sources rise in and the dot keeps a soft pulse; a source (or new data) glides the dot to its share while the numbers
 * count to it.
 */
function MonthlyIncomeChart({
  netDelta, initialVisibleSources, summaryLabel = "GMV 净变化",
  title = "Monthly Income",
  value: valueProp,
  target = SAMPLE_TARGET,
  targetLabel = "of monthly target",
  sourcesTitle = "Income Sources",
  sourcesDescription = "Monthly recurring revenue and freelance project mockups.",
  sources = sampleMonthlyIncomeSources,
  index: indexProp,
  defaultIndex = null,
  onIndexChange,
  onSourceActivate,
  insightLabel = "See insight",
  onInsightClick,
  onMoreClick,
  locale = "en-US",
  currency = "USD",
  className,
  ...props
}: MonthlyIncomeChartProps) {
  const [expanded, setExpanded] = React.useState(false)
  const ranked = sources.map((s,i)=>({s,i})).sort((a,b)=>Math.abs(b.s.amount)-Math.abs(a.s.amount))
  const visibleIndices = new Set((sources.some(s=>s.kind==='factor')?ranked.filter(r=>r.s.kind==='factor'):ranked).slice(0,initialVisibleSources ?? sources.length).map(r=>r.i))
  sources.forEach((s,i)=>{if(s.kind==='residual')visibleIndices.add(i)})
  const remaining = sources.filter((_,i)=>!visibleIndices.has(i))
  const n = sources.length
  const total = valueProp ?? sources.reduce((sum, source) => sum + source.amount, 0)
  const [indexValue, setIndex] = useControllableState<number | null>({
    value: indexProp,
    defaultValue: defaultIndex,
    onChange: (next) => onIndexChange?.(next, next === null ? undefined : sources[next]),
  })
  const selected = indexValue !== null && indexValue >= 0 && indexValue < n ? Math.round(indexValue) : null
  const [hovered, setHovered] = React.useState<number | null>(null)
  const [focused, setFocused] = React.useState<number | null>(null)
  const preview = hovered ?? focused
  const active = preview !== null && preview < n ? preview : selected
  const shown = active !== null ? sources[active].amount : total
  const share = (netDelta ?? total) !== 0 ? shown / (netDelta ?? total) : null
  const progress = target > 0 ? Math.min(1, Math.abs(shown) / target) : 0

  const [gaugeRef, gauge] = useChartSize<HTMLDivElement>({ width: GAUGE_WIDTH, height: GAUGE_HEIGHT })
  const width = gauge.width || GAUGE_WIDTH
  const layout = React.useMemo(() => gaugeLayout(width), [width])
  const { cx, cy } = layout
  const theta = layout.from + progress * (layout.to - layout.from)
  const dotX = cx + RADIUS * Math.cos(rad(theta))
  const dotY = cy + RADIUS * Math.sin(rad(theta))

  const compact = React.useCallback((n: number) => signedMoney(n), [locale, currency])
  const signed = React.useCallback(
    (n: number) => signedMoney(n),
    [locale, currency],
  )
  const percent = React.useCallback(
    (n: number) => (netDelta ?? total) === 0 ? "—" : shareLabel(n/100),
    [netDelta, total],
  )
  const valueText = compact(shown)
  const percentText = share == null ? "—" : percent((share ?? 0) * 100)

  const reduced = useReducedMotion()
  const root = React.useRef<HTMLDivElement>(null)
  const greenRef = React.useRef<SVGGElement>(null)
  const greyRef = React.useRef<SVGGElement>(null)
  const dotRef = React.useRef<SVGGElement>(null)
  const haloRef = React.useRef<SVGCircleElement>(null)
  const valueRef = React.useRef<HTMLParagraphElement>(null)
  const percentRef = React.useRef<HTMLSpanElement>(null)
  const ids = React.useId().replace(/[^\w-]/g, "")
  const all = (selector: string) => Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])

  // What the entrance's frames need at play time (the card may be resized, or a source hovered, before it is done).
  const latest = React.useRef({ layout, theta, progress, shown, share, valueText, percentText })
  useIsomorphicLayoutEffect(() => {
    latest.current = { layout, theta, progress, shown, share, valueText, percentText }
  })

  // Draws the gauge with the dot at `angle`: both arcs turn with it, the green one hides at 0% and the grey one at 100%.
  const drawn = React.useRef({ theta, progress })
  const draw = (angle: number, fill: number) => {
    const { cx, cy } = latest.current.layout
    drawn.current = { theta: angle, progress: fill }
    const turn = `rotate(${round(angle - TOP)} ${round(cx)} ${round(cy)})`
    for (const [el, visible] of [[greenRef.current, fill > 0], [greyRef.current, fill < 1]] as const) {
      el?.setAttribute("transform", turn)
      el?.setAttribute("visibility", visible ? "visible" : "hidden")
    }
    dotRef.current?.setAttribute("transform", `translate(${round(cx + RADIUS * Math.cos(rad(angle)))} ${round(cy + RADIUS * Math.sin(rad(angle)))})`)
  }

  // New values count from the previous ones.
  useCountUp(valueRef, shown, compact, { duration: MORPH })
  useCountUp(percentRef, (share ?? 0) * 100, percent, { duration: MORPH })

  // The dot pulses softly once the card has come in (never with reduced motion).
  const pulse = React.useRef<JSAnimation | null>(null)
  const startPulse = () => {
    const halo = haloRef.current
    if (!halo || pulse.current) return
    pulse.current = animate(halo, { scale: [1, 1.6], opacity: [0.3, 0], duration: 1800, ease: "outQuad", loop: true, loopDelay: 1200 })
  }
  React.useEffect(
    () => () => {
      pulse.current?.cancel()
      pulse.current = null
    },
    [],
  )
  // without motion the dot is still: the pulse stops and its halo goes back to hidden
  useIsomorphicLayoutEffect(() => {
    if (!reduced) return
    pulse.current?.revert()
    pulse.current = null
  }, [reduced])

  // Entrance, once the card is in view: the grey track fades in and the dot pops in at the gauge's start, then sweeps
  // along the track to the month's share with the green arc growing behind it while the amount and the percentage
  // count up; the divider opens, the sources rise in one after another with their amounts counting, the button comes
  // last and the dot starts to pulse.
  const sweep = React.useRef<{ t: number } | null>(null)
  const sweepFrame = (t: number) => {
    const { layout, theta, progress, shown, share } = latest.current
    draw(layout.from + (theta - layout.from) * t, progress * t)
    if (valueRef.current) valueRef.current.textContent = compact(shown * t)
    if (percentRef.current) percentRef.current.textContent = percent((share ?? 0) * 100 * t)
  }
  useChartEntrance(root, (timeline) => {
    const state = { t: 0 }
    sweep.current = state
    sweepFrame(0)
    const amounts = all('[data-slot="monthly-income-chart-amount"]')
    const counter = { t: 0 }
    const count = () => amounts.forEach((el) => (el.textContent = signed(Number(el.dataset.value) * counter.t)))
    count()
    timeline
      .add(greyRef.current ? [greyRef.current] : [], { opacity: { from: 0 }, duration: 700, ease: "outQuad" }, 0)
      .add(all('[data-slot="monthly-income-chart-dot"]'), { scale: { from: 0 }, opacity: { from: 0 }, duration: 600, ease: "outBack(1.8)" }, 100)
      .add(state, { t: [0, 1], duration: SWEEP, ease: "inOutCubic", onUpdate: () => sweepFrame(state.t) }, 350)
      .add(all('[data-slot="monthly-income-chart-caption"]'), { opacity: { from: 0 }, translateY: { from: 6 }, duration: 700, ease: "outQuad", delay: stagger(90) }, 350)
      .add(all('[data-slot="monthly-income-chart-divider"]'), { scaleX: { from: 0 }, duration: 900, ease: "outExpo" }, 500)
      .add(all('[data-slot="monthly-income-chart-heading"] > *'), { opacity: { from: 0 }, translateY: { from: 6 }, duration: 600, ease: "outQuad", delay: stagger(70) }, 600)
      .add(all('[data-slot="monthly-income-chart-row"]'), { opacity: { from: 0 }, translateY: { from: 10 }, duration: 800, ease: "outExpo", delay: stagger(90) }, 700)
      .add(counter, { t: [0, 1], duration: 1100, ease: "outExpo", onUpdate: count }, 750)
      .add(all('[data-slot="monthly-income-chart-insight"]'), { opacity: { from: 0 }, translateY: { from: 6 }, duration: 600, ease: "outQuad" }, 1000)
      .call(startPulse, 350 + SWEEP)
    return () => {
      if (sweep.current === state) sweep.current = null
      const { theta, progress, valueText, percentText } = latest.current
      draw(theta, progress)
      if (valueRef.current) valueRef.current.textContent = valueText
      if (percentRef.current) percentRef.current.textContent = percentText
      amounts.forEach((el) => (el.textContent = signed(Number(el.dataset.value))))
    }
  })

  // A new share (a source previewed, new data) glides the dot along the track from where it is, the arcs turning with
  // it. A resize redraws at once; while the entrance hasn't swept yet, it redraws at the entrance's progress.
  const morph = React.useRef<JSAnimation | null>(null)
  const lastGeometry = React.useRef({ theta, progress, width })
  useIsomorphicLayoutEffect(() => {
    const before = lastGeometry.current
    lastGeometry.current = { theta, progress, width }
    if (before.theta === theta && before.progress === progress && before.width === width) return
    const entrance = sweep.current
    if (entrance && entrance.t < 1) {
      sweepFrame(entrance.t)
      return
    }
    morph.current?.cancel()
    morph.current = null
    if (reduced || before.width !== width) {
      draw(theta, progress)
      return
    }
    const from = drawn.current
    const state = { t: 0 }
    const frame = () => draw(from.theta + (theta - from.theta) * state.t, from.progress + (progress - from.progress) * state.t)
    frame()
    morph.current = animate(state, {
      t: 1,
      duration: MORPH,
      ease: "outExpo",
      onUpdate: frame,
      onComplete: () => {
        morph.current = null
        draw(theta, progress)
      },
    })
  }, [theta, progress, width, reduced])
  React.useEffect(
    () => () => {
      morph.current?.cancel()
    },
    [],
  )

  const select = (next: number) => setIndex(selected === next ? null : next)
  const onSourceKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (event.key === "Escape") {
      if (selected !== null) setIndex(null)
      setHovered(null); setFocused(null)
      return
    }
    const visible = sources.map((_,index)=>index).filter(index=>expanded||visibleIndices.has(index))
    const position = visible.indexOf(i)
    const next = { ArrowDown: position + 1, ArrowRight: position + 1, ArrowUp: position - 1, ArrowLeft: position - 1, Home: 0, End: visible.length - 1 }[event.key]
    if (next === undefined || !visible.length) return
    event.preventDefault()
    all('[data-slot="monthly-income-chart-source"]')[Math.min(Math.max(next, 0), visible.length - 1)]?.focus()
  }

  const down = shown < 0
  const turn = `rotate(${round(theta - TOP)} ${round(cx)} ${round(cy)})`

  return (
    <ChartCard ref={root} role="group" aria-label={title} className={cn("w-full", className)} data-attribution="true" data-tone={active!==null&&sources[active].kind==='residual'?'residual':shown<0?'negative':shown>0?'positive':'neutral'} {...props}>
      <div className="flex items-center justify-between gap-4">
        {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
        <p className="typo-heading-01-semibold -my-0.5 min-w-0 truncate py-0.5 text-fg-loud">{title}</p>
        <ChartButton size="icon" corner="rounded" aria-label="More options" onClick={onMoreClick} className={RING_FOCUS}>
          <DotsHorizontalIcon />
        </ChartButton>
      </div>

      <div
        ref={gaugeRef}
        role="meter"
        aria-label={active !== null ? `${title}: ${sources[active].label}` : title}
        aria-valuemin={-target}
        aria-valuemax={target}
        aria-valuenow={Math.max(-target, Math.min(target, shown))}
        aria-valuetext={`${signedMoney(shown)}, ${percentText} ${targetLabel}`}
        data-slot="monthly-income-chart-gauge"
        className="relative"
        style={{ height: 134 }}
      >
        {/* runs into the card's padding on both sides, where the card's edges cut the track off */}
        <svg aria-hidden className="pointer-events-none absolute top-0 h-full overflow-hidden" style={{ left: -PAD, width: `calc(100% + ${2 * PAD}px)` }}>
          <defs>
            <linearGradient
              id={`${ids}-green`}
              gradientUnits="userSpaceOnUse"
              x1={round(cx + GREEN_FADE.x1)}
              y1={round(cy + GREEN_FADE.y1)}
              x2={round(cx + GREEN_FADE.x2)}
              y2={round(cy + GREEN_FADE.y2)}
            >
              <stop offset="0" style={{ stopColor: "var(--primary-green-500)" }} />
              <stop offset="1" style={{ stopColor: "var(--primary-green-500)", stopOpacity: 0 }} />
            </linearGradient>
            <linearGradient
              id={`${ids}-grey`}
              gradientUnits="userSpaceOnUse"
              x1={round(cx + GREY_FADE.x1)}
              y1={round(cy + GREY_FADE.y1)}
              x2={round(cx + GREY_FADE.x2)}
              y2={round(cy + GREY_FADE.y2)}
            >
              <stop offset="0" style={{ stopColor: "var(--surface-subdued)" }} />
              <stop offset="1" style={{ stopColor: "var(--surface-subdued)", stopOpacity: 0 }} />
            </linearGradient>
            {/* the dot's ring: Primary/Green/green-200 at the top to green-500 at the bottom */}
            <linearGradient id={`${ids}-ring`} gradientUnits="userSpaceOnUse" x1="0" y1={-DOT} x2="0" y2={DOT}>
              <stop offset="0" style={{ stopColor: "var(--primary-green-200)" }} />
              <stop offset="1" style={{ stopColor: "var(--primary-green-500)" }} />
            </linearGradient>
          </defs>
          <g transform={`translate(${PAD} 0)`}>
            {/* Figma "Donut Segment": 17px arcs with round ends, the rest of the track grey… */}
            <g ref={greyRef} data-slot="monthly-income-chart-track" transform={turn} visibility={progress < 1 ? "visible" : "hidden"}>
              <path
                d={arcPath(cx, cy, TOP + GAP + CAP, TOP + GAP + REACH)}
                fill="none"
                stroke={`url(#${ids}-grey)`}
                strokeWidth={TRACK}
                strokeLinecap="round"
              />
            </g>
            {/* …and the share of the target green, up to the dot */}
            <g ref={greenRef} data-slot="monthly-income-chart-progress" transform={turn} visibility={progress > 0 ? "visible" : "hidden"}>
              <path
                d={arcPath(cx, cy, TOP - GAP - REACH, TOP - GAP - CAP)}
                fill="none"
                stroke={`url(#${ids}-green)`}
                strokeWidth={TRACK}
                strokeLinecap="round"
              />
            </g>
            {/* Figma "Dot": white with a 6.7px ring inside its edge */}
            <g ref={dotRef} transform={`translate(${round(dotX)} ${round(dotY)})`}>
              <g data-slot="monthly-income-chart-dot" className="origin-center [transform-box:fill-box]">
                <circle ref={haloRef} r={DOT} className="origin-center fill-primary-green-500 opacity-0 [transform-box:fill-box]" />
                <circle r={DOT} className="fill-surface-white" />
                <path d={DOT_RING} fillRule="evenodd" fill={`url(#${ids}-ring)`} />
              </g>
            </g>
          </g>
        </svg>

        <div aria-hidden className="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-2" style={{ top: 76 }}>
          <span className="income-caption-label">{active!==null?sources[active].label:summaryLabel}</span>
          <p ref={valueRef} data-slot="monthly-income-chart-caption" className="typo-heading-04-semibold hug-w whitespace-nowrap text-fg-loud">
            {valueText}
          </p>
          <p data-slot="monthly-income-chart-caption" className="flex items-center gap-[7.328px] whitespace-nowrap">
            <span ref={percentRef} className={cn("typo-body-03-semibold hug-w transition-colors duration-200", down ? "text-error-500" : "text-primary-green-500")}>
              {percentText}
            </span>
            <span className="typo-body-03-medium hug-w text-fg-loud">{targetLabel}</span>
          </p>
        </div>
      </div>

      {/* Figma "Divider": 1px Border/Soft over [y - 1, y] */}
      <div aria-hidden className="relative h-0">
        <span data-slot="monthly-income-chart-divider" className="absolute inset-x-0 -top-px h-px bg-border-soft" />
      </div>

      <div className="flex flex-col gap-3">
        <div data-slot="monthly-income-chart-heading" className="flex flex-col gap-2">
          <p className="typo-label-03-semibold -my-0.5 truncate py-0.5 text-fg-loud">{sourcesTitle}</p>
          {sourcesDescription && <p className="typo-label-02-medium text-fg-normal">{sourcesDescription}</p>}
        </div>

        <div role="group" aria-label={sourcesTitle} className="flex flex-col gap-3">
          {sources.map((source, i) => {
            if(!expanded && !visibleIndices.has(i))return null
            const on = i === active
            return (
              <div key={source.id} data-slot="monthly-income-chart-row" data-kind={source.kind} data-direction={source.amount<0?"negative":source.amount>0?"positive":"neutral"}>
                <button
                  type="button"
                  data-slot="monthly-income-chart-source"
                  data-active={on || undefined}
                  aria-pressed={onSourceActivate ? undefined : i === selected}
                  aria-label={`${source.label}: ${signed(source.amount)}, ${percent((netDelta ?? total) !== 0 ? (source.amount / (netDelta ?? total)) * 100 : 0)} ${targetLabel}`}
                  onPointerEnter={() => setHovered(i)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={(event) => {
                    if (event.currentTarget.matches(":focus-visible")) setFocused(i)
                  }}
                  onBlur={() => setFocused(null)}
                  onClick={() => onSourceActivate ? onSourceActivate(source) : select(i)}
                  onKeyDown={(event) => onSourceKeyDown(event, i)}
                  className={cn(
                    // Figma "Header Cell": #fbfbfb with a 1px Border/Soft inside stroke, 8px corners
                    "flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-lg bg-surface-white px-[13px] py-4 text-left outline-none",
                    "shadow-[inset_0_0_0_1px_var(--border-soft)] transition-[background-color,box-shadow,opacity] duration-200 focus-visible:ring-2",
                    RING_FOCUS,
                    on && "bg-surface-white shadow-[inset_0_0_0_1px_var(--border-soft),0_1px_2px_rgb(40_40_40/0.08),0_4px_12px_rgb(23_23_23/0.06)]",
                    // a kept source is ringed in the card's green
                    i === selected && "shadow-[inset_0_0_0_1px_rgb(18_170_76/0.5),0_1px_2px_rgb(40_40_40/0.08),0_4px_12px_rgb(23_23_23/0.06)]",
                    active !== null && !on && "opacity-55",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {source.icon && <span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-5">{source.icon}</span>}
                    <span className={cn("typo-label-02-medium -my-0.5 min-w-0 truncate py-0.5 transition-colors duration-200", on ? "text-fg-loud" : "text-fg-normal")}>
                      {source.label}
                    </span>
                  </span>
                  <span className="income-source-reading"><DivergingBar value={total===0?null:source.amount/total} effect={source.amount} scaleMax={Math.max(.000001,...sources.map(s=>total===0?0:Math.abs(s.amount/total)))} variant={source.kind==='residual'?'residual':'root'} label=""/><SourceAmount value={source.amount} format={signed}/></span>
                </button>
              </div>
            )
          })}
          {remaining.length>0&&<button type="button" className="income-expand-sources" aria-expanded={expanded} onClick={()=>{setExpanded(v=>!v);if(expanded)setIndex(null)}}>{expanded?'收起':<>其他 {remaining.length} 项 <span>{signed(remaining.reduce((s,r)=>s+r.amount,0))}</span></>}</button>}
        </div>

        <div data-slot="monthly-income-chart-insight" className="flex">
          <ChartButton onClick={onInsightClick} className={cn("w-full text-fg-normal", RING_FOCUS)}>
            {insightLabel}
            <ArrowUpRightIcon />
          </ChartButton>
        </div>
      </div>
    </ChartCard>
  )
}

export {
  AdobeLogo,
  DribbbleLogo,
  LinkedInLogo,
  MonthlyIncomeChart,
  sampleMonthlyIncomeSources,
  type MonthlyIncomeChartProps,
  type MonthlyIncomeSource,
}
