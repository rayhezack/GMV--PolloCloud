"use client"

import { animate, stagger, svg, utils, type JSAnimation } from "animejs"
import * as React from "react"

import { ChartButton } from "@/components/ui/chart-button"
import { ChartCard } from "@/components/ui/chart-card"
import { CalendarSolidIcon, ChevronDownIcon, DownloadIcon } from "@/components/ui/chart-icons"
import { ChartMenu, ChartMenuContent, ChartMenuRadioGroup, ChartMenuRadioItem, ChartMenuTrigger } from "@/components/ui/chart-menu"
import { ChartSwatch } from "@/components/ui/chart-swatch"
import { ChartTrend } from "@/components/ui/chart-trend"
import { releaseStyles, useChartEntrance, useCountUp, useIsomorphicLayoutEffect, useReducedMotion } from "@/hooks/use-chart-motion"
import { useChartSize } from "@/hooks/use-chart-size"
import { useControllableState } from "@/hooks/use-controllable-state"
import { formatCompactCurrency, formatCurrency, formatPercent, formatTime } from "@/lib/chart-format"
import { alignPolylines, fittedDash, linePath, niceTicks, seededRandom, smoothTangents, valueAt } from "@/lib/chart-series"
import { cn } from "@/lib/utils"
import "./finance-chart/finance-chart.css"
import { flowBarLayout, flowBarTop, bucketLabels } from "./finance-chart/flow-bar-layout"

type GlobalFinanceMarketComboPoint = {
  /** An ISO date ("2026-03-16") or date-time ("2026-03-16T08:00:00Z"), read as UTC. */
  date: string
  value: number
}

type GlobalFinanceMarketComboData = {
  /** The actual assets under management, oldest first: the green line. Its first and last points are the plot's edges. */
  actual: GlobalFinanceMarketComboPoint[]
  /** The forecast for the same time: the dashed line (it may start before the actual line and have its own points). */
  forecast?: GlobalFinanceMarketComboPoint[]
  /** Net flows, signed: a bar each, standing at its date, green for money in and red for money out (drawn as its size). */
  flows?: GlobalFinanceMarketComboPoint[]
  /** The middle stat: the market's growth in percent and its change (not drawn). */
  growth?: { value: number; change?: number }
  /** The last stat: the forecast for the end of a coming year (not drawn). */
  outlook?: { year: number; value: number }
}

type GlobalFinanceMarketComboFilters = { product: string; category: string; period: string }
type GlobalFinanceMarketComboOption = { value: string; label: string }
type GlobalFinanceMarketComboSeries = "actual" | "forecast"

type GlobalFinanceMarketComboChartProps = Omit<React.ComponentProps<"div">, "children"> & {
  toolbar?: React.ReactNode
  formatValue?: (value: number) => string
  formatTooltipValue?: (value: number) => string
  formatChangeValue?: (value: number) => string
  variant?: "combo" | "line"
  title?: string
  /** The soft line under the title. */
  description?: string
  /** What to draw, or a function of the menus' choices that gives it (the sample data answers every choice). */
  data?: GlobalFinanceMarketComboData | ((filters: GlobalFinanceMarketComboFilters) => GlobalFinanceMarketComboData)
  products?: GlobalFinanceMarketComboOption[]
  product?: string
  defaultProduct?: string
  onProductChange?: (product: string) => void
  categories?: GlobalFinanceMarketComboOption[]
  category?: string
  defaultCategory?: string
  onCategoryChange?: (category: string) => void
  periods?: GlobalFinanceMarketComboOption[]
  period?: string
  defaultPeriod?: string
  onPeriodChange?: (period: string) => void
  /** The selected point (an index into `actual`), or null for none (the Figma card). */
  index?: number | null
  defaultIndex?: number | null
  onIndexChange?: (index: number | null, point: GlobalFinanceMarketComboPoint | null) => void
  /** The legend's names for the two lines, also in the tooltip. */
  actualLabel?: string
  forecastLabel?: string
  /** The bars' name in the tooltip. */
  flowLabel?: string
  /** The stats' labels: the first is followed by the year ("Global AUM’26"), the last follows the outlook's year ("2027 Forecast"). */
  aumLabel?: string
  growthLabel?: string
  outlookLabel?: string
  exportLabel?: string
  /** Called with the shown data as CSV by the export button; without it the button downloads `exportFileName`. */
  onExport?: (csv: string) => void
  exportFileName?: string
  locale?: string
  currency?: string
}

type Point = { x: number; y: number }
type Line = (Point & { time: number; value: number })[]
type BarShape = { key: string; time: number; value: number; x: number; width: number; top: number; bottom: number; negative: boolean }

// Figma geometry ("Global Finance Market Combo Chart" 1473:86575)
const PLOT_WIDTH = 890
const PLOT_HEIGHT = 320
const GRID_TOP = 8 // Figma's 1px grid lines cover [y - 1, y]: the top one ends at 8 (the highest tick)…
const BASE = PLOT_HEIGHT // …the axis at 320 (the lowest), and the lines' values sit on those edges
const SPAN = BASE - GRID_TOP
const TICK_COUNT = 5 // labelled, with a dashed line between each two
const BAR_WIDTH = 32
const BAR_RADIUS = 8
const BAR_BOTTOM = BASE - 2 // a bar's fill stops 2px above the axis' edge; its 1px ring stands on the axis line
const LINE_WIDTH = 2
const FORECAST_DASH = 6
// Figma "Stripe Pattern": 4px white bands at 24%, 6px apart, turned 63.95° in a frame 389.59px left of the bar and
// 99.21px under its middle row
const STRIPE_ALONG = { x: 0.43911033868789673, y: -0.8984330296516418 }
const STRIPE_ACROSS = { x: 0.8984330296516418, y: 0.43911033868789673 }
const STRIPE_X = -389.588623046875
const STRIPE_Y = 99.21241760253906
const STRIPE_WIDTH = 4
const STRIPE_PERIOD = 6
const MARKER = 12 // the cursor's dots, as on the Forecast card
const CURSOR_WIDTH = 4
const CURSOR_GAP = 1 // between the cursor's segments and its dots
const CURSOR_END = 319 // the cursor runs from the plot's top to 1px above its bottom
const TIP_GAP = 14 // between the cursor's dots and the tooltip
const TIP_ROW = 30 // the tooltip's first amount starts level with the highest dot (8px padding, the 14px date, an 8px gap)
const TIP_PADDING_X = 24 // the tooltip's 12px side padding, twice
const TIP_PADDING_Y = 16 // and its 8px top and bottom padding
// Figma's glow under the actual line: green-500 at 40%, 3px down, blur 3 (a Gaussian of σ 1.35)
const GLOW = "drop-shadow(0 3px 1.35px rgb(83 58 253 / 0.2))"
const RING = "focus-visible:ring-primary-green-500/40" // the card's focus rings are green, like its line
const DRAW_AT = 450
const DRAW_DURATION = 1500
const GROW = 800
const RIDE = 450
const MORPH = 800

const HOUR = 3_600_000
const DAY = 24 * HOUR
const M = 1_000_000

const timeOf = (date: string) => Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date)
const isoTime = (time: number) => new Date(time).toISOString().replace(".000Z", "Z")
const round = (n: number) => Math.round(n * 1000) / 1000

/** Months since year 0 as a number, every calendar month one unit long (16 February → …1.536), so months are as wide on the axis. */
function monthPosition(time: number) {
  const d = new Date(time)
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  return d.getUTCFullYear() * 12 + d.getUTCMonth() + (time - start) / (Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - start)
}

/**
 * x of a time between `start` (0) and `end` (width). Over more than two months every month gets the same width, as
 * on Figma's axis (whose months are equal); shorter spans are linear in time.
 */
function timeScale(start: number, end: number, width: number) {
  const monthly = end - start > 60 * DAY
  const position = monthly ? monthPosition : (time: number) => time
  const a = position(start)
  const b = position(end)
  return { monthly, x: (time: number) => (b > a ? ((position(time) - a) / (b - a)) * width : width / 2) }
}

// ---------------------------------------------------------------------------------------------------------------
// Sample data

const sampleProducts: GlobalFinanceMarketComboOption[] = [
  { value: "all", label: "All products" },
  { value: "funds", label: "Mutual funds" },
  { value: "etfs", label: "ETFs" },
  { value: "pensions", label: "Pension funds" },
]
const sampleCategories: GlobalFinanceMarketComboOption[] = [
  { value: "all", label: "All category" },
  { value: "equity", label: "Equity" },
  { value: "fixed-income", label: "Fixed income" },
  { value: "alternatives", label: "Alternatives" },
]
const samplePeriods: GlobalFinanceMarketComboOption[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
]

const SAMPLE_START = Date.UTC(2025, 11, 20) // 20 December 2025…
const SAMPLE_END = Date.UTC(2026, 6, 15) // …to 15 July 2026
// The Figma lines on the $0–$80M axis, on a scale that gives every month the same width. The actual assets are read off
// the drawn curve every 8 hours from 20 December 2025 (622 values; drawn as below they stay within 0.4px of Figma's,
// 0.02px on average). The forecast is Figma's own 93 points, spread evenly over the months from 19 December 06:50 (its
// first point is 3px left of the plot, where Figma's dashed line starts) to 15 July; Figma centres a dash on each.
const SAMPLE_ACTUAL = [
  16.41, 16.95, 17.43, 17.86, 18.26, 18.64, 19, 19.32, 19.64, 19.96, 20.33, 20.75, 21.22, 21.76, 22.36, 23.05, 23.9, 25.04, 26.18, 26.99, 27.36,
  27.37, 27.3, 27.18, 27.06, 27, 27.05, 27.43, 28.12, 28.81, 29.18, 29.22, 29.17, 29.08, 28.98, 28.92, 28.92, 28.99, 29.15, 29.43, 29.8, 30.22, 30.67,
  31.07, 31.36, 31.51, 31.54, 31.36, 30.93, 30.33, 29.77, 29.45, 29.28, 29.15, 29.07, 29.04, 29.03, 29.07, 29.17, 29.3, 29.4, 29.44, 29.35, 29.08,
  28.63, 28.13, 27.72, 27.46, 27.27, 27.1, 26.93, 26.7, 26.34, 25.83, 25.3, 24.92, 24.74, 24.74, 24.77, 24.82, 24.86, 24.89, 24.86, 24.65, 24.27,
  23.9, 23.71, 23.72, 23.99, 24.58, 25.45, 26.47, 27.47, 28.47, 29.44, 30.31, 31.04, 31.57, 32.01, 32.35, 32.57, 32.67, 32.69, 32.55, 32.22, 31.78,
  31.36, 31.12, 30.99, 30.9, 30.82, 30.73, 30.61, 30.37, 30.01, 29.61, 29.27, 29.05, 28.96, 28.89, 28.84, 28.77, 28.68, 28.53, 28.34, 28.16, 28.04,
  27.99, 28.06, 28.39, 29.03, 29.77, 30.36, 30.75, 31.05, 31.33, 31.66, 32.13, 32.85, 33.62, 34.17, 34.39, 34.33, 34.06, 33.61, 33.09, 32.65, 32.31,
  32.05, 31.91, 31.86, 31.93, 32.38, 33.25, 34.39, 35.53, 36.54, 37.34, 37.83, 38.05, 38.05, 37.85, 37.49, 37.16, 37.03, 37.29, 38.28, 39.65, 40.56,
  40.73, 40.49, 39.95, 39.4, 39.13, 39.18, 39.54, 40.31, 41.47, 42.86, 44.35, 45.71, 46.67, 47.12, 47.15, 46.97, 46.59, 46.05, 45.46, 44.91, 44.46,
  44.16, 44.02, 44, 44.16, 44.49, 44.83, 44.99, 44.94, 44.6, 44.08, 43.68, 43.57, 43.61, 43.71, 43.83, 43.89, 43.88, 43.69, 43.36, 43.08, 42.97, 43,
  43.1, 43.23, 43.32, 43.34, 43.34, 43.33, 43.32, 43.32, 43.32, 43.53, 44.14, 45.11, 46.22, 47.15, 47.83, 48.38, 48.88, 49.39, 50.02, 50.79, 51.63,
  52.36, 52.82, 53.01, 53, 52.94, 52.83, 52.67, 52.49, 52.32, 52.17, 52.02, 51.87, 51.7, 51.49, 51.21, 50.89, 50.57, 50.29, 50.07, 49.89, 49.73,
  49.57, 49.39, 49.14, 48.74, 48.24, 47.74, 47.35, 47.14, 47.01, 46.92, 46.82, 46.71, 46.57, 46.32, 45.99, 45.61, 45.22, 44.85, 44.49, 44.17, 43.94,
  43.82, 43.78, 43.85, 44.04, 44.38, 44.82, 45.29, 45.73, 46.12, 46.4, 46.56, 46.61, 46.5, 46.12, 45.57, 45.11, 44.93, 45.09, 45.76, 46.84, 48.02,
  48.85, 49.2, 49.44, 49.66, 49.88, 50.15, 50.52, 50.99, 51.46, 51.81, 51.97, 51.94, 51.58, 50.93, 50.31, 50.02, 50.03, 50.26, 50.64, 50.98, 51.13,
  51.1, 50.92, 50.59, 50.19, 49.83, 49.56, 49.34, 49.2, 49.13, 49.11, 49.12, 49.18, 49.31, 49.52, 49.8, 50.2, 50.71, 51.18, 51.49, 51.58, 51.51,
  51.29, 50.91, 50.43, 49.93, 49.5, 49.1, 48.73, 48.34, 47.91, 47.45, 47.03, 46.74, 46.58, 46.56, 46.82, 47.4, 48.2, 48.92, 49.32, 49.59, 49.78,
  49.89, 49.93, 49.94, 49.9, 49.8, 49.63, 49.41, 49.14, 48.77, 48.35, 47.95, 47.67, 47.54, 47.44, 47.39, 47.36, 47.35, 47.34, 47.34, 47.34, 47.34,
  47.34, 47.31, 47.16, 46.9, 46.68, 46.59, 46.69, 47.14, 47.92, 48.86, 49.68, 50.28, 50.76, 51.19, 51.63, 52.14, 52.79, 53.55, 54.42, 55.37, 56.37,
  57.44, 58.54, 59.45, 60.03, 60.25, 60.18, 59.83, 59.29, 58.82, 58.6, 58.64, 58.89, 59.32, 59.71, 59.89, 59.88, 59.73, 59.43, 59.04, 58.66, 58.38,
  58.16, 57.98, 57.81, 57.62, 57.38, 57.08, 56.74, 56.38, 56.02, 55.66, 55.32, 55.03, 54.82, 54.72, 54.72, 55.15, 56.15, 57.33, 58.11, 58.3, 58.2,
  57.95, 57.56, 57.11, 56.73, 56.41, 56.15, 55.91, 55.68, 55.44, 55.15, 54.83, 54.52, 54.28, 54.16, 54.13, 54.12, 54.12, 54.12, 54.12, 54.26, 54.87,
  55.79, 56.59, 56.93, 56.86, 56.42, 55.72, 55.08, 54.78, 54.43, 52.48, 49.1, 45.91, 44.3, 44.14, 44.11, 44.03, 43.89, 43.7, 43.47, 43.18, 42.88,
  42.66, 42.54, 42.53, 42.63, 42.85, 43.1, 43.25, 43.27, 43.28, 43.27, 43.26, 43.24, 43.18, 42.97, 42.64, 42.27, 41.92, 41.65, 41.4, 41.21, 41.1,
  41.05, 41.09, 41.39, 42.05, 43.08, 44.37, 45.76, 47.15, 48.29, 49.01, 49.28, 49.26, 49.09, 48.77, 48.35, 47.89, 47.45, 46.99, 46.57, 46.25, 46.09,
  46.05, 46.03, 46.03, 46.02, 45.98, 45.89, 45.72, 45.55, 45.44, 45.4, 45.63, 46.28, 47.11, 47.67, 47.82, 47.7, 47.36, 46.83, 46.23, 45.68, 45.22,
  44.87, 44.65, 44.55, 44.55, 44.93, 45.77, 46.71, 47.27, 47.39, 47.82, 48.73, 49.69, 50.23, 50.37, 51.06, 52.43, 53.81, 54.54, 54.59, 54.35, 53.82,
  52.99, 51.93, 50.8, 49.69, 48.77, 48.19, 47.95, 47.95, 48.03, 48.2, 48.47, 48.81, 49.22, 49.77, 50.39, 50.99, 51.5, 51.85, 52.12, 52.36, 52.61,
  52.92, 53.35, 53.96, 54.62, 55.12, 55.39, 55.37, 54.85, 53.81, 52.71, 52.06, 52, 52.66, 54.09, 55.69, 56.67, 56.87, 56.76, 56.52, 56.23, 56.04,
  56.01, 56.42, 57.47, 58.76, 59.66, 59.91, 59.88, 59.79, 59.68, 59.6, 59.57
]
const SAMPLE_FORECAST = [
  17.38, 16.1, 14.79, 13.24, 16.84, 15.75, 14.05, 13.02, 11.63, 12.95, 11.28, 15.04, 19.35, 21.75, 24.95, 24.19, 24.19, 23.94, 22.26, 21.6, 22.32,
  24.99, 23.56, 21.56, 19.95, 21.72, 22.43, 21.77, 20.4, 21.54, 19.55, 21.27, 22.57, 26.61, 24.93, 26.25, 27.76, 26.63, 24.93, 24.35, 22.28, 21.37,
  19.92, 19.1, 18.52, 21.43, 24.35, 28.22, 28.2, 28.57, 27.64, 27.97, 26.54, 27.54, 26.15, 24.37, 28.78, 32.42, 30.8, 34.51, 33.47, 36.06, 39.68,
  38.79, 37.14, 39.64, 41.19, 43.55, 42.87, 42.49, 40.92, 40.4, 38.85, 40.13, 44.48, 47.85, 46.65, 46.8, 44.91, 43.86, 42.1, 42.51, 42.06, 39.99,
  41.44, 42.62, 42.31, 44.54, 44.15, 48.29, 51.14, 52.86, 55.13
]
// The Figma bars: net flows on the 1st and the 16th of each month, as tall as drawn (green in, red out)
const SAMPLE_FLOWS: [string, number][] = [
  ["2026-01-01", 15.128],
  ["2026-01-16", 8.974],
  ["2026-02-01", -6.923],
  ["2026-02-16", 13.077],
  ["2026-03-01", -10],
  ["2026-03-16", -5.128],
  ["2026-04-01", 18.462],
  ["2026-04-16", 13.077],
  ["2026-05-01", -10],
  ["2026-05-16", -5.128],
  ["2026-06-01", 6.923],
  ["2026-06-16", 13.077],
  ["2026-07-01", -11.795],
]

const steps = (start: number, step: number, values: number[]) => values.map((value, i) => ({ date: isoTime(start + i * step), value: Math.round(value * M) }))
/** The time at a month position (the inverse of monthPosition). */
function timeAtMonth(position: number) {
  const month = Math.floor(position)
  const start = Date.UTC(Math.floor(month / 12), month % 12, 1)
  return start + (Date.UTC(Math.floor(month / 12), (month % 12) + 1, 1) - start) * (position - month)
}
/** Values spread evenly over the months from `start` to `end` (to the minute). */
const evenlyOnMonths = (start: number, end: number, values: number[]) =>
  values.map((value, i) => {
    const position = monthPosition(start) + ((monthPosition(end) - monthPosition(start)) * i) / Math.max(1, values.length - 1)
    return { date: isoTime(Math.round(timeAtMonth(position) / 60_000) * 60_000), value: Math.round(value * M) }
  })
const SAMPLE: Required<Omit<GlobalFinanceMarketComboData, "growth" | "outlook">> = {
  actual: steps(SAMPLE_START, 8 * HOUR, SAMPLE_ACTUAL),
  forecast: evenlyOnMonths(Date.UTC(2025, 11, 19, 6, 50), SAMPLE_END, SAMPLE_FORECAST),
  flows: SAMPLE_FLOWS.map(([date, value]) => ({ date, value: Math.round(value * M) })),
}

// A product's and a category's share of the market, and a seed for how their lines wander from the whole
const SHARES: Record<string, { share: number; seed: number }> = {
  "product:funds": { share: 0.46, seed: 3 },
  "product:etfs": { share: 0.34, seed: 7 },
  "product:pensions": { share: 0.2, seed: 11 },
  "category:equity": { share: 0.55, seed: 17 },
  "category:fixed-income": { share: 0.3, seed: 23 },
  "category:alternatives": { share: 0.15, seed: 29 },
}

/** A slow, smooth wobble around 1 (a few seeded sine waves), so a filtered line isn't just the whole one scaled. */
function wobble(seed: number, amount: number) {
  const random = seededRandom(seed)
  const waves = Array.from({ length: 3 }, (_, i) => ({ period: (40 + random() * 50) * DAY / (i + 1), phase: random() * Math.PI * 2, size: amount / (i + 1.5) }))
  return (time: number) => 1 + waves.reduce((sum, w) => sum + w.size * Math.sin((2 * Math.PI * (time - SAMPLE_START)) / w.period + w.phase), 0)
}

/** Seeded weekly or daily net flows over the last `count` periods before SAMPLE_END, around a period's share of the half-monthly ones. */
function sampleFlows(seed: number, count: number, span: number, scale: number) {
  const random = seededRandom(seed)
  return Array.from({ length: count }, (_, i) => {
    const sign = random() < 0.62 ? 1 : -1
    return { date: isoTime(SAMPLE_END - (count - i) * span), value: Math.round(sign * (3 + random() * 9) * scale * M) }
  })
}

/**
 * The sample data for the menus' choices: Monthly is the Figma card (7 months), Weekly its last 7 weeks and Daily its
 * last 7 days (with generated weekly and daily flows). A product or a category takes its share of the market, wobbling
 * a little around it (seeded, so the lines are the same on every render).
 */
function sampleGlobalFinanceMarketComboData({ product, category, period }: GlobalFinanceMarketComboFilters): GlobalFinanceMarketComboData {
  const parts = [SHARES[`product:${product}`], SHARES[`category:${category}`]].filter((part) => part !== undefined)
  const share = parts.reduce((total, part) => total * part.share, 1)
  const waves = parts.map((part) => wobble(part.seed, 0.08))
  const factor = (time: number) => share * waves.reduce((total, wave) => total * wave(time), 1)
  // the points from `from` on (and the one before it, so the line comes in from the plot's edge)
  const scaled = (points: GlobalFinanceMarketComboPoint[], from: number) =>
    points
      .filter((p, i) => timeOf(p.date) >= from || (points[i + 1] !== undefined && timeOf(points[i + 1].date) > from))
      .map((p) => ({ date: p.date, value: Math.round(p.value * factor(timeOf(p.date))) }))
  const from = period === "daily" ? SAMPLE_END - 7 * DAY : period === "weekly" ? SAMPLE_END - 49 * DAY : SAMPLE_START - DAY
  const seed = parts.reduce((sum, part) => sum + part.seed, 0)
  const flows =
    period === "daily"
      ? sampleFlows(101 + seed, 7, DAY, share * 0.12)
      : period === "weekly"
        ? sampleFlows(53 + seed, 7, 7 * DAY, share * 0.55)
        : SAMPLE.flows.map((flow) => ({ date: flow.date, value: Math.round(flow.value * factor(timeOf(flow.date)) * (parts.length ? 1 + 0.25 * Math.sin(seed + timeOf(flow.date) / (9 * DAY)) : 1)) }))
  const actual = scaled(SAMPLE.actual, period === "monthly" ? SAMPLE_START : from).filter((p) => timeOf(p.date) >= from)
  const latest = actual[actual.length - 1]?.value ?? 0
  return {
    actual,
    forecast: scaled(SAMPLE.forecast, period === "monthly" ? SAMPLE.forecast.length && timeOf(SAMPLE.forecast[0].date) : from),
    flows,
    // the market's growth is sample data (Figma's 23%, +3.13% for the whole market); the outlook is 6.82% over today
    growth: parts.length ? { value: Math.round((23 + (seed % 7) - 3) * 100) / 100, change: Math.round(((seed % 5) - 1.6) * 100) / 100 } : { value: 23, change: 3.13 },
    outlook: { year: 2027, value: Math.round(latest * 1.0682) },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry

const TURN_HANDLE = 0.425 // Figma's smooth lines pull their handles out to 0.425 of the gap at a turning point (1/3 elsewhere)

/**
 * The cubic segments of Figma's smooth lines (its chart plugin): smoothPath's monotone tangents, the handles a third of
 * the gap long, or TURN_HANDLE of it at a turning point (a flat tangent), which rounds the peaks a little fuller.
 */
function turnSegments(points: Point[]) {
  const n = points.length
  const tangents = smoothTangents(points)
  const reach = (i: number) => (i > 0 && i < n - 1 && tangents[i] === 0 ? TURN_HANDLE : 1 / 3)
  const segments: [Point, Point, Point, Point][] = []
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const h = b.x - a.x
    segments.push([a, { x: a.x + reach(i) * h, y: a.y + reach(i) * h * tangents[i] }, { x: b.x - reach(i + 1) * h, y: b.y - reach(i + 1) * h * tangents[i + 1] }, b])
  }
  return segments
}

function turnPath(points: Point[]) {
  if (points.length < 3) return linePath(points)
  let d = `M ${round(points[0].x)} ${round(points[0].y)}`
  for (const [, c1, c2, b] of turnSegments(points)) d += ` C ${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(b.x)} ${round(b.y)}`
  return d
}

const cubic = (a: number, b: number, c: number, d: number, t: number) => {
  const u = 1 - t
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
}

const curves = new WeakMap<Point[], (x: number) => number>()

/** y of a turnPath line at x (x grows along each segment, so it is solved by bisection). Cached per line. */
function turnCurveAt(points: Point[]) {
  const cached = curves.get(points)
  if (cached) return cached
  const at = curveOf(points)
  curves.set(points, at)
  return at
}

function curveOf(points: Point[]) {
  if (points.length < 3) return (x: number) => valueAt(points, x)
  const segments = turnSegments(points)
  const last = points.length - 1
  return (x: number) => {
    if (x <= points[0].x) return points[0].y
    if (x >= points[last].x) return points[last].y
    let lo = 0
    let hi = last
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (points[mid].x <= x) lo = mid
      else hi = mid
    }
    const [a, c1, c2, b] = segments[lo]
    let t0 = 0
    let t1 = 1
    for (let k = 0; k < 24; k++) {
      const t = (t0 + t1) / 2
      if (cubic(a.x, c1.x, c2.x, b.x, t) < x) t0 = t
      else t1 = t
    }
    return cubic(a.y, c1.y, c2.y, b.y, (t0 + t1) / 2)
  }
}

/** A cubic segment's length (a fine polyline along it). */
function segmentLength([a, c1, c2, b]: [Point, Point, Point, Point]) {
  let length = 0
  let px = a.x
  let py = a.y
  for (let k = 1; k <= 32; k++) {
    const x = cubic(a.x, c1.x, c2.x, b.x, k / 32)
    const y = cubic(a.y, c1.y, c2.y, b.y, k / 32)
    length += Math.hypot(x - px, y - py)
    px = x
    py = y
  }
  return length
}

/**
 * Figma lays a dashed line's dashes out per segment: every segment between two points gets whole periods of dash and
 * gap with half a dash at each end, so a dash is centred on every point. Each segment is its own path here (one dash
 * pattern along the whole line would drift from Figma's as small length differences add up). Lines whose points are
 * closer than about a period are fitted as a whole instead: null.
 */
function dashedSegments(points: Point[], dash: number, gap: number) {
  if (points.length < 3) return null
  const segments = turnSegments(points)
  const lengths = segments.map(segmentLength)
  const total = lengths.reduce((sum, length) => sum + length, 0)
  if (total / segments.length < 0.75 * (dash + gap)) return null
  return segments.map(([a, c1, c2, b], i) => ({
    d: `M ${round(a.x)} ${round(a.y)} C ${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(b.x)} ${round(b.y)}`,
    dash: fittedDash(lengths[i] || 1, dash, gap),
  }))
}

/** The whole line's length, for the dense fallback's fitted dashes. */
const turnLength = (points: Point[]) => (points.length > 2 ? turnSegments(points).reduce((sum, segment) => sum + segmentLength(segment), 0) : 0)

/** A value of a series at a time: linear between its points, undefined outside them. */
function valueOn(points: { time: number; value: number }[], time: number) {
  if (!points.length || time < points[0].time || time > points[points.length - 1].time) return undefined
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (time <= b.time) return b.time === a.time ? b.value : a.value + ((b.value - a.value) * (time - a.time)) / (b.time - a.time)
  }
  return points[points.length - 1].value
}

const sorted = (points: GlobalFinanceMarketComboPoint[] | undefined) =>
  (points ?? [])
    .map((p) => ({ time: timeOf(p.date), value: p.value }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time)

/**
 * Where everything sits at a plot width. The actual line's first and last points are the plot's edges (the forecast may
 * start before them); bars use a zero-based axis while line-only views use a padded data range.
 * A bar is 32px wide, centred on its date at a whole pixel, and as tall as its flow's size.
 */
function layoutChart(data: GlobalFinanceMarketComboData, shown: Record<GlobalFinanceMarketComboSeries, boolean>, width: number, zeroBased = true, period = "day") {
  const actual = sorted(data.actual)
  const forecast = sorted(data.forecast)
  const flows = sorted(data.flows)
  const times = [...actual, ...forecast, ...flows].map((p) => p.time)
  const start = actual[0]?.time ?? Math.min(...times, 0)
  const end = actual[actual.length - 1]?.time ?? Math.max(...times, 1)
  const slots = flowBarLayout(actual.map(point => point.time), width, BAR_WIDTH)
  const inset = Math.min(width / 2, Math.max(MARKER / 2 + 2, flows.length ? slots.inset : 0))
  const scale = timeScale(start, end, Math.max(0, width - 2 * inset))
  const x = (time: number) => inset + scale.x(time)
  const values = [...(shown.actual ? actual : []), ...(shown.forecast ? forecast : []), ...(zeroBased ? flows.map((p) => ({ value: Math.abs(p.value) })) : [])].map((p) => p.value)
  const max = Math.max(0, ...values)
  const min = values.length ? Math.min(...values) : 0
  const pad = Math.max((max - min) * 0.15, Math.abs(max) * 0.03, 0.001)
  const ticks = zeroBased ? niceTicks(0, max > 0 ? max : 1, TICK_COUNT) : niceTicks(Math.max(0, min - pad), max + pad, TICK_COUNT)
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const y = (value: number) => (hi > lo ? BASE - ((value - lo) / (hi - lo)) * SPAN : BASE)
  const line = (points: { time: number; value: number }[]): Line => points.map((p) => ({ ...p, x: x(p.time), y: y(p.value) }))
  const barWidth = slots.width
  const bars: BarShape[] = flows.map((p) => ({
    key: String(p.time),
    time: p.time,
    value: p.value,
    x: x(p.time) - barWidth / 2,
    width: barWidth,
    top: flowBarTop(p.value, y, BAR_BOTTOM),
    bottom: BAR_BOTTOM,
    negative: p.value < 0,
  }))
  // a solid line at each tick (the lowest one the axis) and a dashed one halfway between each two
  const grid = ticks.flatMap((tick, i) => {
    const row = { key: `t${tick}`, y: y(tick) - 0.5, kind: i === 0 ? "axis" : "tick" }
    return i < ticks.length - 1 ? [row, { key: `m${tick}`, y: y((tick + ticks[i + 1]) / 2) - 0.5, kind: "half" }] : [row]
  })
  // Every tick is an observed bucket start; never infer grain from the date span.
  const axisLabels = bucketLabels(actual.map(p => p.time), x, period);

  return { actual: line(actual), forecast: line(forecast), flows, bars, start, end, ticks, y, grid, labels: axisLabels, x }
}

type Layout = ReturnType<typeof layoutChart>

const barPath = (x: number, top: number, bottom: number, radius = BAR_RADIUS, width = BAR_WIDTH) => {
  const h = bottom - top
  if (h <= 0.01 || width <= 0) return `M ${round(x)} ${round(bottom)} Z`
  const r = round(Math.min(radius, h, width / 2))
  const [l, rt, t, b] = [x, x + width, top, bottom].map(round)
  return `M ${l} ${b} V ${round(t + r)} A ${r} ${r} 0 0 1 ${round(l + r)} ${t} H ${round(rt - r)} A ${r} ${r} 0 0 1 ${rt} ${round(t + r)} V ${b} Z`
}
/** The bar's 1px ring (Figma's drop shadow with a spread of 1): the shape grown by 1px, its corners with it. */
const ringPath = (bar: { x: number; width: number; top: number; bottom: number }) => (bar.bottom - bar.top > 0.01 ? barPath(bar.x - 1, bar.top - 1, bar.bottom + 1, BAR_RADIUS + 1, bar.width + 2) : "")

/**
 * The bar's stripes as parallelograms over its whole column (and a period more all round), placed like Figma's pattern
 * frame. The bar's shape clips them.
 */
function stripesPath(bar: { x: number; width: number; top: number; bottom: number }) {
  const ox = bar.x + STRIPE_X
  const oy = bar.top + (bar.bottom - bar.top) / 2 + STRIPE_Y
  const box = [
    [bar.x - STRIPE_PERIOD, -STRIPE_PERIOD],
    [bar.x + bar.width + STRIPE_PERIOD, -STRIPE_PERIOD],
    [bar.x - STRIPE_PERIOD, PLOT_HEIGHT + STRIPE_PERIOD],
    [bar.x + bar.width + STRIPE_PERIOD, PLOT_HEIGHT + STRIPE_PERIOD],
  ]
  const along = box.map(([x, y]) => (x - ox) * STRIPE_ALONG.x + (y - oy) * STRIPE_ALONG.y)
  const across = box.map(([x, y]) => (x - ox) * STRIPE_ACROSS.x + (y - oy) * STRIPE_ACROSS.y)
  const [u0, u1] = [Math.min(...along), Math.max(...along)]
  const point = (u: number, v: number) => `${round(ox + u * STRIPE_ALONG.x + v * STRIPE_ACROSS.x)} ${round(oy + u * STRIPE_ALONG.y + v * STRIPE_ACROSS.y)}`
  let d = ""
  for (let k = Math.floor(Math.min(...across) / STRIPE_PERIOD); k * STRIPE_PERIOD <= Math.max(...across); k++) {
    const v0 = k * STRIPE_PERIOD
    const v1 = v0 + STRIPE_WIDTH
    d += `M ${point(u0, v0)} L ${point(u1, v0)} L ${point(u1, v1)} L ${point(u0, v1)} Z `
  }
  return d.trim()
}

/** Where the cursor's dots and segments sit at x: a dot on each shown line, segments between them, fading at both ends. */
function cursorAt(lines: (Line | null)[], x: number) {
  const dots = lines.map((line) => (line && line.length && x >= line[0].x - 0.01 && x <= line[line.length - 1].x + 0.01 ? turnCurveAt(line)(x) : undefined))
  const ys = dots.filter((d): d is number => d !== undefined).sort((a, b) => a - b)
  const edges = [-Infinity, ...ys, Infinity]
  const segments = edges.slice(0, -1).map((top, i) => {
    const from = top === -Infinity ? 0 : top + MARKER / 2 + CURSOR_GAP
    const to = edges[i + 1] === Infinity ? CURSOR_END : edges[i + 1] - MARKER / 2 - CURSOR_GAP
    return { top: from, height: Math.max(0, to - from) }
  })
  return { dots, segments }
}

const csvCell = (value: string | number | undefined) => (value === undefined ? "" : /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value))

/** The shown data as CSV: a row per time any series has a value. */
function toCsv(layout: Layout, labels: { actual: string; forecast: string; flow: string }) {
  const rows = new Map<number, { actual?: number; forecast?: number; flow?: number }>()
  const put = (time: number, key: "actual" | "forecast" | "flow", value: number) => rows.set(time, { ...rows.get(time), [key]: value })
  for (const p of layout.actual) put(p.time, "actual", p.value)
  for (const p of layout.forecast) put(p.time, "forecast", p.value)
  for (const p of layout.flows) put(p.time, "flow", p.value)
  const lines = [["Date", labels.actual, labels.forecast, labels.flow].map(csvCell).join(",")]
  for (const [time, row] of [...rows].sort((a, b) => a[0] - b[0])) lines.push([isoTime(time), row.actual, row.forecast, row.flow].map(csvCell).join(","))
  return lines.join("\n")
}

// ---------------------------------------------------------------------------------------------------------------
// Parts

/** Untitled UI "container" solid (Figma 16px): the products menu's box. */
function ContainerIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden data-slot="icon" {...props}>
      <path d="M8.26852 0.790031C8.09131 0.753584 7.90853 0.753584 7.73132 0.790031C7.52647 0.832161 7.34338 0.934713 7.19782 1.01624L7.15814 1.03841C5.98285 1.69134 3.99465 2.79644 2.87372 3.41952C2.60155 3.5708 2.46547 3.64644 2.42 3.74642C2.38035 3.83357 2.3801 3.93356 2.4193 4.02091C2.46427 4.12111 2.60008 4.19751 2.87171 4.3503L7.73842 7.08785C7.8338 7.1415 7.88149 7.16832 7.93205 7.17884C7.9768 7.18814 8.02299 7.18814 8.06774 7.17884C8.1183 7.16832 8.16599 7.1415 8.26137 7.08785L13.1281 4.35029C13.3997 4.1975 13.5356 4.12111 13.5805 4.02091C13.6197 3.93355 13.6195 3.83356 13.5798 3.74641C13.5344 3.64644 13.3983 3.57079 13.1261 3.41951C12.0052 2.79644 10.017 1.69134 8.8417 1.03841L8.80203 1.01624C8.65647 0.934713 8.47337 0.832162 8.26852 0.790031Z" />
      <path d="M14.6639 5.92677C14.6636 5.62787 14.6635 5.47843 14.6005 5.39117C14.5455 5.31504 14.4609 5.26564 14.3676 5.25511C14.2606 5.24305 14.1301 5.31646 13.8691 5.46329L8.93845 8.23679C8.83947 8.29247 8.78998 8.3203 8.75396 8.35968C8.72209 8.39452 8.69799 8.43573 8.68325 8.48059C8.66659 8.53129 8.66659 8.58807 8.66659 8.70163V14.1518C8.66659 14.4499 8.66659 14.599 8.72927 14.6862C8.78396 14.7623 8.86814 14.8118 8.9612 14.8227C9.06786 14.8352 9.19777 14.763 9.45758 14.6188C10.5685 14.0019 12.5876 12.8807 13.775 12.221L13.8171 12.1977C13.9712 12.1128 14.165 12.0061 14.3137 11.8447C14.4424 11.7051 14.5397 11.5397 14.5993 11.3594C14.6682 11.1509 14.6673 10.9298 14.6667 10.7538L14.6666 10.7058C14.6666 9.39704 14.6649 7.17087 14.6639 5.92677Z" />
      <path d="M6.54226 14.6187C6.80207 14.763 6.93198 14.8352 7.03864 14.8227C7.13169 14.8118 7.21588 14.7623 7.27057 14.6862C7.33325 14.599 7.33325 14.4499 7.33325 14.1518V8.70166C7.33325 8.5881 7.33325 8.53132 7.31659 8.48062C7.30185 8.43576 7.27774 8.39455 7.24588 8.35971C7.20986 8.32033 7.16037 8.29249 7.06139 8.23682L2.13074 5.4633C1.86972 5.31648 1.73921 5.24306 1.63225 5.25513C1.53893 5.26565 1.45438 5.31506 1.39939 5.39118C1.33636 5.47844 1.33624 5.62789 1.33599 5.92678C1.33495 7.17088 1.33325 9.39704 1.33325 10.7058L1.33314 10.7538C1.33249 10.9298 1.33169 11.1509 1.40057 11.3594C1.46012 11.5397 1.55746 11.7051 1.6861 11.8447C1.83487 12.0061 2.02861 12.1128 2.18269 12.1977L2.22481 12.221C3.41227 12.8807 5.43135 14.0019 6.54226 14.6187Z" />
    </svg>
  )
}

/** Untitled UI "dotpoints-01" solid (Figma 16px): the categories menu's list. */
function DotpointsIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden data-slot="icon" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M5.3335 8.00033C5.3335 7.63214 5.63197 7.33366 6.00016 7.33366L14.0002 7.33366C14.3684 7.33366 14.6668 7.63214 14.6668 8.00033C14.6668 8.36852 14.3684 8.66699 14.0002 8.66699L6.00016 8.66699C5.63197 8.66699 5.3335 8.36852 5.3335 8.00033Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M5.3335 4.00033C5.3335 3.63214 5.63197 3.33366 6.00016 3.33366L14.0002 3.33366C14.3684 3.33366 14.6668 3.63214 14.6668 4.00033C14.6668 4.36852 14.3684 4.66699 14.0002 4.66699L6.00016 4.66699C5.63197 4.66699 5.3335 4.36852 5.3335 4.00033Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M5.3335 12.0003C5.3335 11.6321 5.63197 11.3337 6.00016 11.3337L14.0002 11.3337C14.3684 11.3337 14.6668 11.6321 14.6668 12.0003C14.6668 12.3685 14.3684 12.667 14.0002 12.667L6.00016 12.667C5.63197 12.667 5.3335 12.3685 5.3335 12.0003Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M1.3335 8.00033C1.3335 7.26395 1.93045 6.66699 2.66683 6.66699C3.40321 6.66699 4.00016 7.26395 4.00016 8.00033C4.00016 8.73671 3.40321 9.33366 2.66683 9.33366C1.93045 9.33366 1.3335 8.73671 1.3335 8.00033Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M1.3335 4.00033C1.3335 3.26395 1.93045 2.66699 2.66683 2.66699C3.40321 2.66699 4.00016 3.26395 4.00016 4.00033C4.00016 4.73671 3.40321 5.33366 2.66683 5.33366C1.93045 5.33366 1.3335 4.73671 1.3335 4.00033Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M1.3335 12.0003C1.3335 11.2639 1.93045 10.667 2.66683 10.667C3.40321 10.667 4.00016 11.2639 4.00016 12.0003C4.00016 12.7367 3.40321 13.3337 2.66683 13.3337C1.93045 13.3337 1.3335 12.7367 1.3335 12.0003Z" />
    </svg>
  )
}

/** A stat on Background/Disable: its label, the number (counting to new values) and its change. */
function Stat({
  label,
  value,
  change,
  kind,
  format,
  locale,
}: {
  label: string
  value: number | undefined
  change: number | undefined
  /** How the entrance counts the number up. */
  kind: "money" | "percent"
  format: (value: number) => string
  locale: string
}) {
  const valueRef = React.useRef<HTMLParagraphElement>(null)
  useCountUp(valueRef, value ?? 0, format, { enabled: value !== undefined, duration: 900 })
  return (
    <div data-slot="global-finance-market-combo-chart-stat" className="flex min-w-0 flex-1 flex-col items-start gap-3 overflow-hidden rounded-2xl bg-surface-disable p-4">
      <p className="typo-label-02-medium hug-w -my-0.5 max-w-full truncate py-0.5 text-fg-soft">{label}</p>
      {/* the Figma text box is 30px tall for the 24px style, which centres the glyphs 3px lower */}
      <p
        ref={valueRef}
        data-slot="global-finance-market-combo-chart-stat-value"
        data-value={value}
        data-format={kind}
        className="typo-heading-02-semibold hug-w leading-[30px] whitespace-nowrap text-fg-loud"
      >
        {value !== undefined ? format(value) : "–"}
      </p>
      {change !== undefined ? <ChartTrend value={change} fractionDigits={2} locale={locale} /> : <span aria-hidden className="h-3.5" />}
    </div>
  )
}

/** A menu button of the actions row: icon, the chosen option, chevron. */
function FilterMenu({
  icon,
  name,
  options,
  value,
  onValueChange,
}: {
  icon: React.ReactNode
  name: string
  options: GlobalFinanceMarketComboOption[]
  value: string
  onValueChange: (value: string) => void
}) {
  const label = options.find((option) => option.value === value)?.label ?? value
  return (
    <ChartMenu>
      <ChartMenuTrigger {...{ asChild: true }}>
        <ChartButton corner="rounded" aria-label={`${name}: ${label}`} className={cn("group/trigger text-fg-normal", RING)}>
          {icon}
          {label}
          <ChevronDownIcon className="transition-transform duration-200 group-data-[state=open]/trigger:rotate-180" />
        </ChartButton>
      </ChartMenuTrigger>
      <ChartMenuContent align="start">
        <ChartMenuRadioGroup value={value} onValueChange={onValueChange}>
          {options.map((option) => (
            <ChartMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </ChartMenuRadioItem>
          ))}
        </ChartMenuRadioGroup>
      </ChartMenuContent>
    </ChartMenu>
  )
}

type TooltipText = {
  date: string
  rows: { key: string; label: string; value: string; swatch: string; tone?: string }[]
}

/** The tooltip's lines. Rendered twice: visible and as an invisible copy that is measured. */
function TooltipLines({ text }: { text: TooltipText }) {
  return (
    <>
      <span className="typo-label-02-regular hug-w text-fg-soft">{text.date}</span>
      {text.rows.map((row) => (
        <span key={row.key} className="flex items-center gap-1.5">
          <ChartSwatch className={cn("h-5 w-1 transition-colors duration-300", row.swatch)} />
          <span className={cn("typo-label-03-medium hug-w", row.tone ?? "text-fg-loud")}>{row.value}</span>
          <span className="typo-label-02-regular hug-w text-fg-soft">{row.label}</span>
        </span>
      ))}
    </>
  )
}

/**
 * "Global Finance Market Combo Chart" from the Keitoto library: the market's assets under management against the
 * forecast, with the net flows under them. A green line (with a soft glow) is the actual total, a dashed grey line the
 * forecast, and hatched bars stand on the axis twice a month, green for money in and red for money out, as tall as the
 * amount. Over it: stats for the assets (against the forecast), the market's growth and the coming year's forecast, an
 * export button, menus for the product, the category and the period, and a legend whose items turn their line off.
 * Hover (or drag on touch) shows a cursor with a dot on each line and a tooltip with the day's amounts and its bar's
 * flow; a click keeps it, the arrow keys move it. Animated with anime.js: the header and the stats come in counting up,
 * the grid draws, the forecast sweeps in, the bars grow from the axis as the green line draws itself over them; a new
 * choice in a menu morphs the lines and the bars while the numbers count.
 */
function GlobalFinanceMarketComboChart({
  toolbar, formatValue, formatTooltipValue, formatChangeValue, variant = "combo",
  title = "Global finance market overview",
  description = "2020-2027",
  data = sampleGlobalFinanceMarketComboData,
  products = sampleProducts,
  product: productProp,
  defaultProduct,
  onProductChange,
  categories = sampleCategories,
  category: categoryProp,
  defaultCategory,
  onCategoryChange,
  periods = samplePeriods,
  period: periodProp,
  defaultPeriod,
  onPeriodChange,
  index: indexProp,
  defaultIndex = null,
  onIndexChange,
  actualLabel = "Total AUM (Actual)",
  forecastLabel = "Forecast",
  flowLabel = "Net flow",
  aumLabel = "Global AUM",
  growthLabel = "Market growth",
  outlookLabel = "Forecast",
  exportLabel = "Export CSV",
  onExport,
  exportFileName = "global-finance-market.csv",
  locale = "en-US",
  currency = "USD",
  className,
  ...props
}: GlobalFinanceMarketComboChartProps) {
  const [product, setProduct] = useControllableState({ value: productProp, defaultValue: defaultProduct ?? products[0]?.value ?? "", onChange: onProductChange })
  const [category, setCategory] = useControllableState({ value: categoryProp, defaultValue: defaultCategory ?? categories[0]?.value ?? "", onChange: onCategoryChange })
  const [period, setPeriod] = useControllableState({ value: periodProp, defaultValue: defaultPeriod ?? periods[periods.length - 1]?.value ?? "", onChange: onPeriodChange })
  const shownData = React.useMemo(() => (typeof data === "function" ? data({ product, category, period }) : data), [data, product, category, period])
  const [shown, setShown] = React.useState<Record<GlobalFinanceMarketComboSeries, boolean>>({ actual: true, forecast: true })

  const [plotRef, plot] = useChartSize<HTMLDivElement>({ width: PLOT_WIDTH, height: PLOT_HEIGHT })
  const width = plot.width || PLOT_WIDTH
  const layout = React.useMemo(() => layoutChart(shownData, shown, width, variant === "combo" && period === "day", period), [shownData, shown, width, variant, period])
  const { actual, forecast, bars, ticks, grid, labels } = layout
  const n = actual.length
  // Content keys: parents may pass new arrays on every render, so changes are detected by value.
  const dataKey = `${actual.map((p) => `${p.time}=${p.value}`).join(",")}|${forecast.map((p) => `${p.time}=${p.value}`).join(",")}`
  const barsKey = bars.map((bar) => `${bar.key}=${bar.value}`).join(",")
  const shapeKey = `${dataKey}|${barsKey}|${ticks.join(";")}`
  const ticksKey = ticks.join(";")
  const labelsKey = labels.map((label) => label.key).join(";")

  const [indexValue, setIndex] = useControllableState<number | null>({
    value: indexProp,
    defaultValue: defaultIndex,
    onChange: (next) => {
      const point = next === null ? null : shownData.actual[next] ?? null
      onIndexChange?.(next, point)
    },
  })
  const selected = indexValue !== null && indexValue >= 0 && indexValue < n ? Math.round(indexValue) : null
  const [hovered, setHovered] = React.useState<number | null>(null)
  const [held, setHeld] = React.useState(n - 1)
  const active = hovered !== null && hovered < n ? hovered : selected
  const visible = active !== null
  const at = Math.max(0, Math.min(active ?? held, n - 1))
  const point = actual[at]
  const cursorX = point?.x ?? 0
  const lines = React.useMemo(() => [shown.actual ? actual : null, shown.forecast && forecast.length ? forecast : null], [actual, forecast, shown])
  const cursor = React.useMemo(() => cursorAt(lines, cursorX), [lines, cursorX])
  // the bar whose half-month (or week, or day) the point falls in: the last one standing at or before it
  const activeBar = visible && point ? bars.findIndex(bar => bar.time === point.time) : -1

  const money = React.useCallback((value: number) => formatValue ? formatValue(value) : formatCompactCurrency(value, { locale, currency, minimumFractionDigits: 1 }), [locale, currency, formatValue])
  const exact = React.useCallback((value: number) => formatTooltipValue ? formatTooltipValue(value) : formatCurrency(value, { locale, currency, maximumFractionDigits: 0 }), [locale, currency, formatTooltipValue])
  const percent = React.useCallback((value: number) => formatPercent(value, { locale, maximumFractionDigits: 0 }), [locale])
  const step = n > 1 ? (actual[n - 1].time - actual[0].time) / (n - 1) : DAY
  const dateText = (time: number, withTime = step < DAY && layout.end - layout.start <= 10 * DAY) =>
    formatTime(time, withTime ? { month: "short", day: "numeric", hour: "numeric" } : { month: "short", day: "numeric", year: "numeric" }, locale)
  const labelText = (label: Layout["labels"][number]) => formatTime(label.time, label.unit === "month" ? { month: "short" } : { month: "short", day: "numeric" }, locale)

  // What the stats read: the actual assets at the chosen point (the latest without one) against the forecast there,
  // the market's growth and the outlook (data).
  const chosen = actual[selected ?? n - 1]
  const forecastThen = chosen ? valueOn(forecast, chosen.time) : undefined
  const aum = chosen?.value
  const aumChange = aum !== undefined && forecastThen ? (aum / forecastThen - 1) * 100 : undefined
  const outlook = shownData.outlook
  const latestValue = actual[n - 1]?.value
  const outlookChange = outlook && outlook.year > 0 && latestValue ? (outlook.value / latestValue - 1) * 100 : undefined
  const chosenYear = chosen ? new Date(chosen.time).getUTCFullYear() : new Date(layout.end).getUTCFullYear()

  const bucketText = (i: number) => {
    const bar = bars[i]
    if (!bar) return ""
    return formatTime(bar.time, { month: "short", day: "numeric" }, locale)
  }
  const tooltip: TooltipText | undefined = point
    ? {
        date: dateText(point.time),
        rows: [
          { key: "actual", label: actualLabel, value: exact(point.value), swatch: "bg-primary-green-500" },
          ...(forecast.length ? [{ key: "forecast", label: forecastLabel, value: (() => { const v = valueOn(forecast, point.time); return v === undefined ? "–" : exact(v) })(), swatch: "bg-surface-subdued" }] : []),
          ...(activeBar >= 0
            ? [
                {
                  key: "flow",
                  label: `${flowLabel} · ${bucketText(activeBar)}`,
                  value: formatChangeValue ? formatChangeValue(bars[activeBar].value) : formatCurrency(bars[activeBar].value, { locale, currency, signDisplay: "exceptZero", maximumFractionDigits: 0 }),
                  swatch: bars[activeBar].negative ? "bg-error-500" : "bg-primary-green-500",
                  tone: bars[activeBar].negative ? "text-error-500" : "text-primary-green-500",
                },
              ]
            : []),
        ],
      }
    : undefined

  // The tooltip sits right of the cursor (left of it near the right edge), its first value row level with the highest
  // dot. Its size is measured on an invisible copy that holds the final text.
  const [sizerRef, sizer] = useChartSize<HTMLSpanElement>({ width: 220, height: 96 })
  const tipWidth = sizer.width + TIP_PADDING_X
  const tipHeight = sizer.height + TIP_PADDING_Y
  const flipped = cursorX + MARKER / 2 + TIP_GAP + tipWidth > width
  const tipLeft = Math.round(flipped ? cursorX - MARKER / 2 - TIP_GAP - tipWidth : cursorX + MARKER / 2 + TIP_GAP)
  const highest = Math.min(...cursor.dots.filter((d): d is number => d !== undefined), PLOT_HEIGHT / 2)
  const tipTop = Math.round(Math.min(Math.max(highest - TIP_ROW, 0), Math.max(0, PLOT_HEIGHT - tipHeight)))

  const reduced = useReducedMotion()
  const root = React.useRef<HTMLDivElement>(null)
  const cursorRef = React.useRef<HTMLDivElement>(null)
  const tipRef = React.useRef<HTMLDivElement>(null)
  const actualRef = React.useRef<SVGPathElement>(null)
  const forecastRef = React.useRef<SVGGElement>(null)
  const forecastMorphRef = React.useRef<SVGPathElement>(null)
  const wipeRef = React.useRef<SVGRectElement>(null)
  const ids = React.useId().replace(/[^\w-]/g, "")
  const all = (selector: string) => Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])
  const barGroups = () => Array.from(root.current?.querySelectorAll<SVGGElement>('[data-slot="global-finance-market-combo-chart-bar"]') ?? [])

  // Figma's 6/6 dashes, a dash centred on each of the forecast's points (or fitted along a dense line)
  const forecastSegments = React.useMemo(() => dashedSegments(forecast, FORECAST_DASH, FORECAST_DASH), [forecast])
  const forecastDash = React.useMemo(() => fittedDash(turnLength(forecast) || 1, FORECAST_DASH, FORECAST_DASH), [forecast])
  const actualPath = React.useMemo(() => turnPath(actual), [actual])
  const stripes = React.useMemo(() => bars.map((bar) => stripesPath(bar)), [bars])

  // Paints the cursor and its dots at x (the rides draw in between React's renders).
  const latestLayout = React.useRef({ lines, cursorX })
  useIsomorphicLayoutEffect(() => {
    latestLayout.current = { lines, cursorX }
  })
  const paintCursor = React.useCallback((x: number) => {
    const { lines, cursorX } = latestLayout.current
    const el = cursorRef.current
    if (!el) return
    const geometry = cursorAt(lines, x)
    el.style.transform = `translateX(${x - cursorX}px)`
    el.querySelectorAll<HTMLElement>('[data-slot="global-finance-market-combo-chart-segment"]').forEach((segment, i) => {
      const part = geometry.segments[i]
      segment.style.top = `${part?.top ?? 0}px`
      segment.style.height = `${part?.height ?? 0}px`
    })
    el.querySelectorAll<HTMLElement>('[data-slot="global-finance-market-combo-chart-dot"]').forEach((dot, i) => {
      const y = geometry.dots[i]
      dot.style.top = `${(y ?? 0) - MARKER / 2}px`
      dot.style.visibility = y === undefined ? "hidden" : ""
    })
  }, [])
  /** Puts everything back where React renders it (the positions it renders are the final ones). */
  const settleCursor = React.useCallback(() => {
    paintCursor(latestLayout.current.cursorX)
    cursorRef.current?.style.removeProperty("transform")
  }, [paintCursor])

  // Draws a bar at a shape (the ring, the fill's clip and the inside stroke follow it); `grown` gives its shape `t` of
  // the way up from the axis.
  const shownBars = React.useRef<BarShape[]>(bars)
  const paintBar = (group: SVGGElement | undefined, bar: { x: number; width: number; top: number; bottom: number }) => {
    if (!group) return
    group.querySelector('[data-part="ring"]')?.setAttribute("d", ringPath(bar))
    for (const part of group.querySelectorAll('[data-part="shape"]')) part.setAttribute("d", barPath(bar.x, bar.top, bar.bottom, BAR_RADIUS, bar.width))
    root.current?.querySelector(`#${ids}-bar-${group.dataset.index} path`)?.setAttribute("d", barPath(bar.x, bar.top, bar.bottom, BAR_RADIUS, bar.width))
  }
  const grown = (bar: BarShape, t: number) => ({ ...bar, top: bar.bottom + (bar.top - bar.bottom) * t })
  // How far the entrance has grown each bar (null without one), so a redraw before it is done keeps them there.
  const growing = React.useRef<{ t: number }[] | null>(null)

  // The numbers the entrance counts up from zero.
  const counted = { aum: aum ?? 0, growth: shownData.growth?.value ?? 0, outlook: outlook?.value ?? 0 }
  const counts = React.useRef(counted)
  const latestBars = React.useRef(bars)
  useIsomorphicLayoutEffect(() => {
    counts.current = counted
    latestBars.current = bars
  })

  // Entrance, once the card is in view: the title and the export button come in, the stats rise and count up, the
  // menus and the legend follow, the grid draws across and the labels come in, the forecast sweeps in left to right, the
  // bars grow from the axis one after another and the green line draws itself over them.
  useChartEntrance(root, (timeline) => {
    const line = actualRef.current
    const wipe = wipeRef.current
    const groups = barGroups()
    const growth = groups.map(() => ({ t: 0 }))
    growing.current = growth
    const grow = (i: number) => {
      const bar = latestBars.current[i]
      if (bar) paintBar(groups[i], grown(bar, growth[i].t))
    }
    groups.forEach((_, i) => grow(i))
    const counter = { t: 0 }
    const count = () => {
      all('[data-slot="global-finance-market-combo-chart-stat-value"]').forEach((el) => {
        const value = Number(el.dataset.value)
        if (Number.isFinite(value)) el.textContent = el.dataset.format === "percent" ? percent(value * counter.t) : money(value * counter.t)
      })
    }
    count()
    timeline
      .add(all('[data-slot="global-finance-market-combo-chart-heading"] > *, [data-slot="global-finance-market-combo-chart-header"] > button'), { opacity: { from: 0 }, translateY: { from: 6 }, duration: 700, ease: "outExpo", delay: stagger(80) }, 0)
      .add(all('[data-slot="global-finance-market-combo-chart-stat"]'), { opacity: { from: 0 }, translateY: { from: 8 }, duration: 700, ease: "outExpo", delay: stagger(90) }, 120)
      .add(counter, { t: [0, 1], duration: 1500, ease: "outExpo", onUpdate: count }, 160)
      .add(all('[data-slot="global-finance-market-combo-chart-menus"] button'), { opacity: { from: 0 }, translateY: { from: 6 }, duration: 600, ease: "outExpo", delay: stagger(70) }, 220)
      .add(all('[data-slot="global-finance-market-combo-chart-legend"] > button'), { opacity: { from: 0 }, translateX: { from: -6 }, duration: 600, ease: "outExpo", delay: stagger(80) }, 300)
      .add(all('[data-slot="global-finance-market-combo-chart-row"]'), { x2: { from: 0 }, duration: 900, ease: "outQuad", delay: stagger(35) }, 250)
      .add(all('[data-slot="global-finance-market-combo-chart-tick"]'), { opacity: { from: 0 }, translateX: { from: -4 }, duration: 600, ease: "outQuad", delay: stagger(45) }, 320)
      .add(all('[data-slot="global-finance-market-combo-chart-label"] > span'), { opacity: { from: 0 }, translateY: { from: 4 }, duration: 600, ease: "outQuad", delay: stagger(45) }, 380)
    if (wipe) {
      wipe.setAttribute("width", "0")
      const sweep = { w: 0 }
      timeline.add(sweep, { w: [0, 1], duration: DRAW_DURATION, ease: "inOutSine", onUpdate: () => wipe.setAttribute("width", String(sweep.w * (width + 8))), onComplete: () => wipe.setAttribute("width", String(width + 8)) }, DRAW_AT - 150)
    }
    // each bar grows as the line's sweep passes it (inOutSine reaches x after acos(1 - 2x/width) / π of the duration)
    growth.forEach((state, i) => {
      const bar = latestBars.current[i]
      const reach = bar ? Math.acos(1 - 2 * Math.min(1, Math.max(0, (bar.x + bar.width / 2) / width))) / Math.PI : 0
      timeline.add(state, { t: [0, 1], duration: GROW, ease: "outBack(1.3)", onUpdate: () => grow(i) }, DRAW_AT + reach * DRAW_DURATION - 200)
    })
    if (line) timeline.add(svg.createDrawable(line), { draw: ["0 0", "0 1"], duration: DRAW_DURATION, ease: "inOutSine" }, DRAW_AT)
    return () => {
      if (growing.current === growth) growing.current = null
      groups.forEach((group, i) => {
        const bar = latestBars.current[i]
        if (bar) paintBar(group, bar)
      })
      // createDrawable leaves its dash attributes (revert sets them to "hidden"): give the plain line back
      for (const attribute of ["pathLength", "stroke-dasharray", "stroke-dashoffset"]) line?.removeAttribute(attribute)
      wipe?.setAttribute("width", String(width + 8))
      count()
      all('[data-slot="global-finance-market-combo-chart-stat-value"]').forEach((el) => {
        const value = Number(el.dataset.value)
        if (Number.isFinite(value)) el.textContent = el.dataset.format === "percent" ? percent(value) : money(value)
      })
    }
  })

  // A new point sends the cursor riding along the lines (its dots follow the curves) and slides the tooltip over; when
  // the tooltip changes sides it pops in again. The cursor pops in and out with the tooltip.
  const drawnX = React.useRef(cursorX)
  const ride = React.useRef<JSAnimation | null>(null)
  const lastSelection = React.useRef({ cursorX, width, dataKey, visible, tipLeft, tipTop, flipped })
  useIsomorphicLayoutEffect(() => {
    const before = lastSelection.current
    lastSelection.current = { cursorX, width, dataKey, visible, tipLeft, tipTop, flipped }
    const tip = tipRef.current
    const el = cursorRef.current
    if (reduced || before.width !== width || before.dataKey !== dataKey) {
      ride.current?.cancel()
      drawnX.current = cursorX
      settleCursor()
      return
    }
    if (before.visible !== visible) {
      ride.current?.cancel()
      drawnX.current = cursorX
      settleCursor()
      if (visible) {
        if (tip) animate(tip, { opacity: [0, 1], scale: [0.94, 1], translateY: [6, 0], duration: 350, ease: "outBack(1.6)", onComplete: releaseStyles("opacity", "transform") })
        if (el) animate(el.querySelectorAll("[data-slot] > span"), { opacity: [0, 1], scale: [0.6, 1], duration: 300, ease: "outBack(1.8)", onComplete: releaseStyles("opacity", "transform") })
      } else if (tip) animate(tip, { opacity: [1, 0], duration: 200, ease: "outQuad", onComplete: releaseStyles("opacity") })
      return
    }
    if (!visible) return
    if (tip && (before.tipLeft !== tipLeft || before.tipTop !== tipTop || before.flipped !== flipped)) {
      if (before.flipped !== flipped) animate(tip, { opacity: [0, 1], scale: [0.94, 1], duration: 300, ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
      else
        animate(tip, {
          translateX: [before.tipLeft - tipLeft + utils.get(tip, "translateX", false), 0],
          translateY: [before.tipTop - tipTop + utils.get(tip, "translateY", false), 0],
          duration: RIDE,
          ease: "outExpo",
          onComplete: releaseStyles("transform"),
        })
    }
    const from = drawnX.current
    if (from === cursorX) return
    const state = { x: from }
    ride.current?.cancel()
    paintCursor(from)
    ride.current = animate(state, {
      x: cursorX,
      duration: RIDE,
      ease: "outExpo",
      onUpdate: () => {
        drawnX.current = state.x
        paintCursor(state.x)
      },
      onComplete: () => {
        drawnX.current = cursorX
        settleCursor()
      },
    })
  }, [cursorX, width, dataKey, visible, tipLeft, tipTop, flipped, reduced])

  // New data (a menu, a legend toggle that rescales the axis) morphs both lines and every bar from what is on screen:
  // a bar that stays (the same date) moves and resizes, a new one grows from the axis. A resize redraws at once; while
  // the entrance runs, the bars are redrawn as far as it has grown them.
  const shownLines = React.useRef({ actual, forecast })
  const lastShape = React.useRef({ key: shapeKey, width })
  const morph = React.useRef<JSAnimation | null>(null)
  useIsomorphicLayoutEffect(() => {
    const before = lastShape.current
    lastShape.current = { key: shapeKey, width }
    const fromLines = shownLines.current
    shownLines.current = { actual, forecast }
    const fromBars = shownBars.current
    shownBars.current = bars
    if (before.key === shapeKey && before.width === width) return
    const groups = barGroups()
    const morphing = !!morph.current
    morph.current?.cancel()
    morph.current = null
    const entrance = growing.current
    if (entrance?.some((state) => state.t < 1)) {
      groups.forEach((group, i) => bars[i] && paintBar(group, grown(bars[i], entrance[i]?.t ?? 1)))
      return
    }
    const line = actualRef.current
    const segments = forecastRef.current
    const stand = forecastMorphRef.current
    if (reduced || (before.width !== width && !morphing)) {
      groups.forEach((group, i) => bars[i] && paintBar(group, bars[i]))
      return
    }
    const pair = fromLines.actual.length && actual.length ? alignPolylines(fromLines.actual, actual, 48, turnCurveAt) : null
    const dashedPair = fromLines.forecast.length && forecast.length ? alignPolylines(fromLines.forecast, forecast, 48, turnCurveAt) : null
    const byKey = new Map(fromBars.map((bar) => [bar.key, bar]))
    const starts = bars.map((bar) => byKey.get(bar.key) ?? { ...bar, top: bar.bottom })
    // the forecast's segments step aside for one path that changes shape (fitted dashes), and come back at the end
    if (dashedPair && segments && stand) segments.style.visibility = "hidden"
    const frame = (t: number) => {
      if (pair && line) line.setAttribute("d", turnPath(pair.xs.map((x, i) => ({ x, y: pair.from[i] + (pair.to[i] - pair.from[i]) * t }))))
      if (dashedPair && stand) stand.setAttribute("d", turnPath(dashedPair.xs.map((x, i) => ({ x, y: dashedPair.from[i] + (dashedPair.to[i] - dashedPair.from[i]) * t }))))
      groups.forEach((group, i) => {
        const bar = bars[i]
        const start = starts[i]
        if (bar && start) paintBar(group, { x: start.x + (bar.x - start.x) * t, width: start.width + (bar.width - start.width) * t, top: start.top + (bar.top - start.top) * t, bottom: bar.bottom })
      })
    }
    const finish = () => {
      line?.setAttribute("d", turnPath(actual))
      stand?.setAttribute("d", "")
      segments?.style.removeProperty("visibility")
      groups.forEach((group, i) => bars[i] && paintBar(group, bars[i]))
    }
    const state = { t: 0 }
    frame(0)
    morph.current = animate(state, {
      t: 1,
      duration: MORPH,
      ease: "outExpo",
      onUpdate: () => frame(state.t),
      onComplete: () => {
        morph.current = null
        finish()
      },
      onCancel: finish,
    })
    const appeared = [!pair && line, !dashedPair && segments].filter((el): el is SVGPathElement | SVGGElement => !!el)
    if (appeared.length) animate(appeared, { opacity: [0, 1], duration: 500, ease: "outQuad", onComplete: releaseStyles("opacity") })
  }, [shapeKey, width, reduced])
  React.useEffect(
    () => () => {
      ride.current?.cancel()
      morph.current?.cancel()
    },
    [],
  )

  // New ticks or new axis labels fade in again.
  const lastLabels = React.useRef({ ticksKey, labelsKey })
  useIsomorphicLayoutEffect(() => {
    const before = lastLabels.current
    lastLabels.current = { ticksKey, labelsKey }
    if (reduced) return
    if (before.ticksKey !== ticksKey)
      animate(all('[data-slot="global-finance-market-combo-chart-tick"]'), { opacity: [0, 1], translateX: [-4, 0], duration: 450, delay: stagger(35), ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
    if (before.labelsKey !== labelsKey)
      animate(all('[data-slot="global-finance-market-combo-chart-label"] > span'), { opacity: [0, 1], translateY: [4, 0], duration: 450, delay: stagger(30), ease: "outQuad", onComplete: releaseStyles("opacity", "transform") })
  }, [ticksKey, labelsKey, reduced])

  const choose = (setter: (value: string) => void) => (value: string) => {
    setHovered(null)
    setIndex(null)
    setter(value)
  }
  const select = (i: number | null) => {
    setIndex(i)
    if (i !== null) setHeld(i)
  }
  const hover = (i: number | null) => {
    setHovered(i)
    if (i !== null) setHeld(i)
  }
  // Pointer positions in the plot's own pixels (the live demo may scale the card with CSS zoom).
  const pointAt = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.currentTarget
    const box = target.getBoundingClientRect()
    const zoom = box.width / (target.offsetWidth || box.width || 1) || 1
    const x = (event.clientX - box.left) / zoom
    if (!n) return null
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (actual[mid].x <= x) lo = mid
      else hi = mid
    }
    return Math.abs(actual[lo].x - x) <= Math.abs(actual[hi].x - x) ? lo : hi
  }
  // the arrow keys step a day (or one point when the points are a day or more apart), Page keys a week
  const dayStep = Math.max(1, Math.round(DAY / (step || DAY)))
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      hover(null)
      if (selected !== null) select(null)
      return
    }
    const from = active ?? n - 1
    const next = { ArrowRight: from + dayStep, ArrowLeft: from - dayStep, PageUp: from + 7 * dayStep, PageDown: from - 7 * dayStep, Home: 0, End: n - 1 }[event.key]
    if (next === undefined || !n) return
    event.preventDefault()
    hover(null)
    select(Math.min(Math.max(next, 0), n - 1))
  }
  const toggle = (series: GlobalFinanceMarketComboSeries) => {
    setShown((current) => {
      const next = { ...current, [series]: !current[series] }
      return next.actual || next.forecast ? next : current
    })
  }
  const exportCsv = () => {
    const csv = toCsv(layout, { actual: actualLabel, forecast: forecastLabel, flow: flowLabel })
    if (onExport) {
      onExport(csv)
      return
    }
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = exportFileName
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const valueText = point
    ? `${dateText(point.time, true)}: ${actualLabel} ${exact(point.value)}${(() => {
        const v = valueOn(forecast, point.time)
        return v === undefined ? "" : `, ${forecastLabel} ${exact(v)}`
      })()}`
    : undefined
  const gridDash = fittedDash(width, 5, 5)
  const legendDash = fittedDash(24, 4, 4)

  return (
    <ChartCard ref={root} role="group" aria-label={title} className={cn("finance-combo w-full gap-0 p-0", className)} {...props}>
      {/* Figma "Card Header": 20px padding and a 1px Border/Soft line inside along the bottom */}
      <div data-slot="global-finance-market-combo-chart-header" hidden={!title} className={cn(!title && "!hidden", "flex items-center justify-between gap-4 border-b border-border-soft px-5 pt-5 pb-[19px]")}>
        <div data-slot="global-finance-market-combo-chart-heading" className="flex min-w-0 flex-1 flex-col items-start gap-2">
          {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
          <p className="typo-heading-01-semibold -my-0.5 w-full truncate py-0.5 text-fg-loud">{title}</p>
          {description && <p className="typo-label-02-medium hug-w -my-0.5 max-w-full truncate py-0.5 text-fg-soft">{description}</p>}
        </div>
        <ChartButton corner="rounded" onClick={exportCsv} className={cn("text-fg-normal", RING)}>
          <DownloadIcon />
          {exportLabel}
        </ChartButton>
      </div>

      {/* Figma "Stats": three equal tiles 12px apart; they wrap when the card gets too narrow for the amounts */}
      {variant === "combo" && <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 p-5">
        <Stat label={chosen ? dateText(chosen.time, false) : aumLabel} value={aum} change={aumChange} kind="money" format={money} locale={locale} />
        <Stat label={growthLabel} value={shownData.growth?.value} change={shownData.growth?.change} kind="percent" format={percent} locale={locale} />
        <Stat label={outlookLabel} value={outlook?.value} change={outlookChange} kind="money" format={money} locale={locale} />
      </div>}

      <div className="flex flex-col gap-4 p-5">
        {toolbar || <div data-slot="global-finance-market-combo-chart-menus" className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <FilterMenu icon={<ContainerIcon />} name="Product" options={products} value={product} onValueChange={choose(setProduct)} />
            <FilterMenu icon={<DotpointsIcon />} name="Category" options={categories} value={category} onValueChange={choose(setCategory)} />
          </div>
          <FilterMenu icon={<CalendarSolidIcon />} name="Period" options={periods} value={period} onValueChange={choose(setPeriod)} />
        </div>}

        {/* Figma legend: a 24px marker line (4px) and the name, 6px apart; the items 12px apart. They turn their line off. */}
        <div data-slot="global-finance-market-combo-chart-legend" className="flex flex-wrap items-center gap-3 py-1">
          {(
            [
              { series: "actual", label: actualLabel, dash: undefined },
              { series: "forecast", label: forecastLabel, dash: legendDash },
            ] as const
          ).map((item) => (
            <button
              key={item.series}
              type="button"
              aria-pressed={shown[item.series]}
              onClick={() => toggle(item.series)}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-md outline-none transition-opacity duration-300 focus-visible:ring-2",
                RING,
                !shown[item.series] && "opacity-40",
              )}
            >
              <svg aria-hidden width={24} height={4} className="shrink-0 overflow-visible">
                <line x1={0} x2={24} y1={2} y2={2} strokeWidth={4} className={item.series === "actual" ? "stroke-primary-green-500" : "stroke-border-sub"} {...(item.dash ?? {})} />
              </svg>
              <span className="typo-label-02-medium hug-w whitespace-nowrap text-fg-normal">{item.label}</span>
            </button>
          ))}
        </div>

        <div data-slot="global-finance-market-combo-chart-frame" className="flex min-w-0 w-full items-start gap-3">
          {/* Figma "Y Axis Labels": 38px wide, spread over the plot's height, left-aligned */}
          <div aria-hidden className="hug-w flex min-w-[38px] shrink-0 flex-col justify-between" style={{ height: PLOT_HEIGHT }}>
            {[...ticks].reverse().map((tick) => (
              <span key={tick} data-slot="global-finance-market-combo-chart-tick" className="typo-label-02-regular whitespace-nowrap text-fg-soft">
                {formatValue ? formatValue(tick) : formatCompactCurrency(tick, { locale, currency })}
              </span>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div
              ref={plotRef}
              data-slot="global-finance-market-combo-chart-plot"
              className="relative"
              style={{ height: PLOT_HEIGHT }}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") hover(null)
              }}
            >
              <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
                <defs>
                  {/* the bars' inside stroke: white at 24% fading out downward */}
                  <linearGradient id={`${ids}-stroke`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#fff" stopOpacity={0.24} />
                    <stop offset="1" stopColor="#fff" stopOpacity={0} />
                  </linearGradient>
                  {bars.map((bar, i) => (
                    <clipPath key={bar.key} id={`${ids}-bar-${i}`}>
                      <path d={barPath(bar.x, bar.top, bar.bottom, BAR_RADIUS, bar.width)} />
                    </clipPath>
                  ))}
                  {/* the forecast sweeps in behind this */}
                  <clipPath id={`${ids}-wipe`}>
                    <rect ref={wipeRef} x={-4} y={-10} width={width + 8} height={PLOT_HEIGHT + 20} />
                  </clipPath>
                </defs>
                {/* Figma "Grid Lines": 1px over [y - 1, y]; Border/Soft at each tick, dashed 5/5 between them, the axis Border/Sub */}
                {grid.map((row) => (
                  <line
                    key={row.key}
                    data-slot="global-finance-market-combo-chart-row"
                    x1={0}
                    x2={width}
                    y1={row.y}
                    y2={row.y}
                    className={row.kind === "axis" ? "stroke-border-sub" : "stroke-border-soft"}
                    {...(row.kind === "half" ? gridDash : {})}
                  />
                ))}
                {/* Figma "singleLine0": the forecast, 2px Border/Sub dashed 6/6. The morph path stands in for it while the
                    line changes shape (the segments are hidden then). */}
                {forecast.length > 0 && (
                  <g
                    data-slot="global-finance-market-combo-chart-forecast"
                    clipPath={`url(#${ids}-wipe)`}
                    fill="none"
                    strokeWidth={LINE_WIDTH}
                    className={cn("stroke-border-sub transition-opacity duration-300", !shown.forecast && "opacity-0")}
                  >
                    <g ref={forecastRef}>
                      {forecastSegments ? forecastSegments.map((segment, i) => <path key={i} d={segment.d} {...segment.dash} />) : <path d={turnPath(forecast)} {...forecastDash} />}
                    </g>
                    <path ref={forecastMorphRef} d="" {...forecastDash} />
                  </g>
                )}
                {/* Figma "Bar": green-100 (error-100 for money out) with a 1px green-200 (error-200) ring, white stripes at
                    24% and a 1px white inside stroke fading out downward; 8px top corners */}
                {bars.map((bar, i) => (
                  <g
                    key={bar.key}
                    data-slot="global-finance-market-combo-chart-bar"
                    data-index={i}
                    className={cn("transition-opacity duration-200", activeBar >= 0 && i !== activeBar && "opacity-40")}
                  >
                    <path data-part="ring" d={ringPath(bar)} className={bar.negative ? "fill-error-200" : "fill-primary-green-200"} />
                    <g clipPath={`url(#${ids}-bar-${i})`}>
                      <rect x={bar.x} y={0} width={bar.width} height={PLOT_HEIGHT} className={bar.negative ? "fill-error-100" : "fill-primary-green-100"} />
                      <path d={stripes[i]} fill="#fff" fillOpacity={0.24} />
                      <path data-part="shape" d={barPath(bar.x, bar.top, bar.bottom, BAR_RADIUS, bar.width)} fill="none" stroke={`url(#${ids}-stroke)`} strokeWidth={2} />
                    </g>
                  </g>
                ))}
                {/* Figma "singleLine0": the actual total, 2px green-500 with a soft glow under it */}
                {actual.length > 0 && (
                  <path
                    ref={actualRef}
                    data-slot="global-finance-market-combo-chart-actual"
                    d={actualPath}
                    fill="none"
                    strokeWidth={LINE_WIDTH}
                    className={cn("stroke-primary-green-500 transition-opacity duration-300", !shown.actual && "opacity-0")}
                    style={{ filter: GLOW }}
                  />
                )}
              </svg>

              {point && (
                // the Forecast card's cursor, in green: 4px segments between the dots, the end ones fading out
                <div
                  ref={cursorRef}
                  aria-hidden
                  data-slot="global-finance-market-combo-chart-cursor"
                  className={cn("pointer-events-none absolute top-0", !visible && "invisible")}
                  style={{ left: Math.floor(cursorX) - MARKER / 2, width: MARKER, height: CURSOR_END }}
                >
                  <div className="absolute inset-0" style={{ transform: `translateX(${cursorX - Math.floor(cursorX)}px)` }}>
                    {cursor.segments.map((segment, i) => (
                      <span
                        key={`segment-${i}`}
                        data-slot="global-finance-market-combo-chart-segment"
                        className="absolute"
                        style={{ left: (MARKER - CURSOR_WIDTH) / 2, width: CURSOR_WIDTH, top: segment.top, height: segment.height }}
                      >
                        <span
                          className={cn(
                            "block size-full",
                            // Figma paints later effects on top; CSS paints the first shadow on top
                            "shadow-[0_2px_3.6px_rgb(0_0_0/0.06),0_4px_14.4px_rgb(0_0_0/0.08)]",
                            i === 0
                              ? "bg-linear-to-b from-primary-green-50 to-primary-green-500"
                              : i === cursor.segments.length - 1
                                ? "bg-linear-to-b from-primary-green-500 to-primary-green-50"
                                : "bg-primary-green-500",
                          )}
                        />
                      </span>
                    ))}
                    {cursor.dots.map((y, i) => (
                      <span
                        key={`dot-${i}`}
                        data-slot="global-finance-market-combo-chart-dot"
                        className="absolute left-0 size-3"
                        style={{ top: (y ?? 0) - MARKER / 2, visibility: y === undefined ? "hidden" : undefined }}
                      >
                        <span
                          className={cn(
                            "block size-full rounded-full bg-surface-white",
                            // Figma paints later effects on top; CSS paints the first shadow on top
                            i === 0
                              ? "shadow-[inset_0_0_0_2px_var(--primary-green-100),0_0_0_2px_var(--primary-green-500),0_4px_7.2px_rgb(0_0_0/0.06),0_8px_28.8px_rgb(0_0_0/0.08)]"
                              : "shadow-[inset_0_0_0_2px_var(--surface-disable),0_0_0_2px_var(--border-sub),0_4px_7.2px_rgb(0_0_0/0.06),0_8px_28.8px_rgb(0_0_0/0.08)]",
                          )}
                        />
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div
                role="slider"
                tabIndex={n ? 0 : -1}
                aria-label={`${actualLabel}趋势数据`}
                aria-orientation="horizontal"
                aria-valuemin={0}
                aria-valuemax={Math.max(0, n - 1)}
                aria-valuenow={Math.max(0, active ?? n - 1)}
                aria-valuetext={valueText}
                data-slot="global-finance-market-combo-chart-scrubber"
                onPointerMove={(event) => hover(pointAt(event))}
                onPointerDown={(event) => {
                  if (event.pointerType !== "mouse") hover(pointAt(event))
                }}
                onPointerUp={(event) => {
                  if (event.button !== 0) return
                  const i = pointAt(event)
                  select(i === selected ? null : i)
                }}
                onKeyDown={onKeyDown}
                onFocus={(event) => {
                  if (event.currentTarget.matches(":focus-visible") && active === null && n) hover(n - 1)
                }}
                onBlur={() => hover(null)}
                className={cn("absolute inset-0 cursor-pointer touch-pan-y rounded-lg outline-none focus-visible:ring-2", RING)}
              />

              {tooltip && (
                <div
                  ref={tipRef}
                  aria-hidden
                  data-slot="global-finance-market-combo-chart-tooltip"
                  className={cn(
                    "pointer-events-none absolute flex flex-col items-start gap-2 overflow-hidden rounded-xl bg-surface-white px-3 py-2 whitespace-nowrap",
                    // Figma paints later effects on top; CSS paints the first shadow on top
                    "shadow-[0_0_0_1px_#ececec,0_2px_4px_rgb(0_0_0/0.06),0_4px_16px_rgb(0_0_0/0.08)]",
                    !visible && "opacity-0",
                  )}
                  style={{ left: tipLeft, top: tipTop }}
                >
                  <TooltipLines text={tooltip} />
                </div>
              )}
              {/* the same lines, measured to place the tooltip */}
              {tooltip && (
                <span ref={sizerRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex flex-col items-start gap-2 whitespace-nowrap">
                  <TooltipLines text={tooltip} />
                </span>
              )}
            </div>

            {/* the months (or the Mondays, or the days) centred on their first moment */}
            <div aria-hidden data-slot="global-finance-market-combo-chart-axis" className="relative h-3.5">
              {labels.map((label) => (
                <span key={label.key} data-slot="global-finance-market-combo-chart-label" className="absolute top-0" data-align={label.align} style={{ left: label.x }}>
                  <span className="typo-label-02-regular block -translate-x-1/2 whitespace-nowrap text-fg-soft">{labelText(label)}</span>
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
  GlobalFinanceMarketComboChart,
  sampleGlobalFinanceMarketComboData,
  type GlobalFinanceMarketComboChartProps,
  type GlobalFinanceMarketComboData,
  type GlobalFinanceMarketComboFilters,
  type GlobalFinanceMarketComboOption,
  type GlobalFinanceMarketComboPoint,
}
