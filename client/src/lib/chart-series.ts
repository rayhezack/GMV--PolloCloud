// Geometry and scales for the chart cards: lines (straight or smooth) and their areas, a line drawing itself in,
// Figma's rounded vertices, dashes, gradients and sparkles, axis ticks and repeatable sample data. A series is points
// at x ∈ [0, 1] (position along the period) with a value; the path helpers take pixel points ({ x, y }).

export type SeriesPoint = { x: number; value: number }

/** Scales a series into a width × height box: x across, values on [0, max] bottom to top. */
export function seriesToPixels(points: SeriesPoint[], width: number, height: number, max = Math.max(0, ...points.map((p) => p.value))) {
  return points.map((p) => ({ x: p.x * width, y: max > 0 ? height * (1 - p.value / max) : height }))
}

/** "M x y L x y …" through the points. */
export function linePath(points: { x: number; y: number }[]) {
  return points.map((p, i) => `${i ? "L" : "M"} ${round(p.x)} ${round(p.y)}`).join(" ")
}

/**
 * The tangents (dy/dx at each point) of smoothPath's curve through the points: monotone like d3's curveMonotoneX, so
 * 0 at a peak or a valley. All 0 for fewer than 3 points.
 */
export function smoothTangents(points: { x: number; y: number }[]) {
  const n = points.length
  const slope = (i: number) => (points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x || 1)
  const tangents = new Array<number>(n).fill(0)
  for (let i = 1; i < n - 1; i++) {
    const h0 = points[i].x - points[i - 1].x
    const h1 = points[i + 1].x - points[i].x
    const s0 = slope(i - 1)
    const s1 = slope(i)
    const p = (s0 * h1 + s1 * h0) / (h0 + h1 || 1)
    tangents[i] = (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
  }
  if (n > 2) {
    tangents[0] = (3 * slope(0) - tangents[1]) / 2
    tangents[n - 1] = (3 * slope(n - 2) - tangents[n - 2]) / 2
  }
  return tangents
}

/**
 * A smooth path through the points (monotone cubic, like d3's curveMonotoneX): it never overshoots between two
 * points, and peaks and valleys stay where the data puts them.
 */
export function smoothPath(points: { x: number; y: number }[]) {
  const n = points.length
  if (n < 3) return linePath(points)
  const tangents = smoothTangents(points)
  let d = `M ${round(points[0].x)} ${round(points[0].y)}`
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const h = (b.x - a.x) / 3
    d += ` C ${round(a.x + h)} ${round(a.y + h * tangents[i])} ${round(b.x - h)} ${round(b.y - h * tangents[i + 1])} ${round(b.x)} ${round(b.y)}`
  }
  return d
}

/** The closed area under a line, its top edge `offset` px below the line (the Keitoto area fills start 1.5px under the stroke). */
export function areaPath(points: { x: number; y: number }[], height: number, offset = 0) {
  if (!points.length) return ""
  const top = points.map((p) => ({ x: p.x, y: Math.min(p.y + offset, height) }))
  return `${linePath(top)} L ${round(top[top.length - 1].x)} ${round(height)} L ${round(top[0].x)} ${round(height)} Z`
}

/** y of a polyline at x (linear between vertices, clamped at the ends). */
export function valueAt(points: { x: number; y: number }[], x: number) {
  if (!points.length) return 0
  if (x <= points[0].x) return points[0].y
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (x <= b.x) return b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x)
  }
  return points[points.length - 1].y
}

/**
 * y of smoothPath's curve through the points at x, as a function of x (build it once per line, call it per x). The
 * curve's cubics run linearly in x between two points, so this is exact. Clamped at the ends; under 3 points it is
 * valueAt's straight line.
 */
export function smoothCurveAt(points: { x: number; y: number }[]) {
  if (points.length < 3) return (x: number) => valueAt(points, x)
  const tangents = smoothTangents(points)
  return (x: number) => {
    if (x <= points[0].x) return points[0].y
    let lo = 0
    let hi = points.length - 1
    if (x >= points[hi].x) return points[hi].y
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (points[mid].x <= x) lo = mid
      else hi = mid
    }
    const a = points[lo]
    const b = points[hi]
    const h = b.x - a.x
    const t = h ? (x - a.x) / h : 0
    const c1 = a.y + (h / 3) * tangents[lo]
    const c2 = b.y - (h / 3) * tangents[hi]
    const u = 1 - t
    return u * u * u * a.y + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * b.y
  }
}

/**
 * Two lines resampled on the same x positions (every vertex of both, plus `extra` evenly spaced ones), so a morph can
 * interpolate y alone: at 0 it is exactly the first line, at 1 exactly the second. `curveAt` reads a line at x: its
 * straight segments (valueAt) by default, smoothCurveAt for smoothPath lines.
 */
export function alignPolylines(
  from: { x: number; y: number }[],
  to: { x: number; y: number }[],
  extra = 24,
  curveAt: (line: { x: number; y: number }[]) => (x: number) => number = (line) => (x) => valueAt(line, x),
) {
  const left = Math.min(from[0]?.x ?? 0, to[0]?.x ?? 0)
  const right = Math.max(from[from.length - 1]?.x ?? 0, to[to.length - 1]?.x ?? 0)
  const xs = new Set<number>([...from.map((p) => p.x), ...to.map((p) => p.x)])
  for (let i = 0; i <= extra; i++) xs.add(left + ((right - left) * i) / extra)
  const sorted = [...xs].sort((a, b) => a - b)
  const fromAt = curveAt(from)
  const toAt = curveAt(to)
  return { xs: sorted, from: sorted.map((x) => fromAt(x)), to: sorted.map((x) => toAt(x)) }
}

/** Each vertex's distance along the polyline from its first one: the lengths xAtLength and reachAt measure in. */
export function polylineLengths(line: { x: number; y: number }[]) {
  const lengths = [0]
  for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y))
  return lengths
}

/**
 * x of the point `fraction` (0–1) of the way along the polyline's length: where the tip of a stroke drawing itself in
 * is, for what follows it (a wipe, a fill). `lengths` from polylineLengths, when you have them already.
 */
export function xAtLength(line: { x: number; y: number }[], fraction: number, lengths = polylineLengths(line)) {
  if (!line.length) return 0
  const target = fraction * lengths[lengths.length - 1]
  for (let i = 1; i < line.length; i++) {
    if (lengths[i] < target) continue
    const span = lengths[i] - lengths[i - 1]
    return line[i - 1].x + (line[i].x - line[i - 1].x) * (span ? (target - lengths[i - 1]) / span : 1)
  }
  return line[line.length - 1].x
}

/**
 * How far into an inOutSine draw of the polyline (0–1 of its duration) the stroke reaches x, to time what happens as
 * the tip gets there (a cursor growing, a node popping). `lengths` from polylineLengths, when you have them already.
 */
export function reachAt(line: { x: number; y: number }[], x: number, lengths = polylineLengths(line)) {
  const total = lengths[lengths.length - 1]
  if (!total) return 0
  let length = total
  for (let i = 1; i < line.length; i++) {
    if (x > line[i].x) continue
    const a = line[i - 1]
    const b = line[i]
    length = lengths[i - 1] + (lengths[i] - lengths[i - 1]) * Math.max(0, Math.min(1, b.x === a.x ? 1 : (x - a.x) / (b.x - a.x)))
    break
  }
  // inOutSine has drawn a share s of the length after acos(1 - 2s) / π of its duration
  return Math.acos(1 - 2 * (length / total)) / Math.PI
}

/** A piece of a roundCorners line: a straight segment, or a corner's arc (its centre and radius, and whether it bulges up). */
export type EdgePiece = { from: { x: number; y: number }; to: { x: number; y: number }; arc?: { cx: number; cy: number; r: number; up: boolean } }

/**
 * The line through the points as Figma draws it with a corner radius on every vertex: each corner is a circular arc of
 * `radius` tangent to both segments (smaller where a segment is too short for it). Returns the SVG path and its
 * pieces, so markers can sit on the line as drawn (edgeAt).
 */
export function roundCorners(points: { x: number; y: number }[], radius = 2) {
  const pieces: EdgePiece[] = []
  if (!points.length) return { d: "", pieces }
  let d = `M ${round(points[0].x)} ${round(points[0].y)}`
  let at = points[0]
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]
    const b = points[i]
    const c = points[i + 1]
    const ux = a.x - b.x
    const uy = a.y - b.y
    const vx = c.x - b.x
    const vy = c.y - b.y
    const lu = Math.hypot(ux, uy)
    const lv = Math.hypot(vx, vy)
    const angle = lu && lv ? Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (lu * lv)))) : Math.PI
    if (angle < 1e-6 || angle > Math.PI - 1e-6) {
      pieces.push({ from: at, to: b })
      d += ` L ${round(b.x)} ${round(b.y)}`
      at = b
      continue
    }
    const tan = Math.tan(angle / 2)
    const t = Math.min(radius / tan, lu / 2, lv / 2)
    const r = t * tan
    const start = { x: b.x + (ux / lu) * t, y: b.y + (uy / lu) * t }
    const end = { x: b.x + (vx / lv) * t, y: b.y + (vy / lv) * t }
    // the centre lies on the corner's bisector, r / sin(angle / 2) from the vertex
    const bx = ux / lu + vx / lv
    const by = uy / lu + vy / lv
    const bl = Math.hypot(bx, by) || 1
    const reach = r / Math.sin(angle / 2)
    const cx = b.x + (bx / bl) * reach
    const cy = b.y + (by / bl) * reach
    // the arc turns the way the line does: clockwise on screen when (b - a) × (c - b) > 0
    const sweep = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0 ? 1 : 0
    pieces.push({ from: at, to: start }, { from: start, to: end, arc: { cx, cy, r, up: cy > b.y } })
    d += ` L ${round(start.x)} ${round(start.y)} A ${round(r)} ${round(r)} 0 0 ${sweep} ${round(end.x)} ${round(end.y)}`
    at = end
  }
  const last = points[points.length - 1]
  if (points.length > 1) {
    pieces.push({ from: at, to: last })
    d += ` L ${round(last.x)} ${round(last.y)}`
  }
  return { d, pieces }
}

/** y of a roundCorners line at x, from its pieces (undefined outside it). */
export function edgeAt(pieces: EdgePiece[], x: number) {
  for (const piece of pieces) {
    if (x < Math.min(piece.from.x, piece.to.x) - 1e-6 || x > Math.max(piece.from.x, piece.to.x) + 1e-6) continue
    if (piece.arc) {
      const { cx, cy, r, up } = piece.arc
      const h = Math.sqrt(Math.max(0, r * r - (x - cx) ** 2))
      return up ? cy - h : cy + h
    }
    const span = piece.to.x - piece.from.x
    return span ? piece.from.y + ((piece.to.y - piece.from.y) * (x - piece.from.x)) / span : piece.to.y
  }
  return undefined
}

/**
 * `count` evenly spaced round ticks covering [min, max], the step a 1, 2, 2.5 or 5 × 10ⁿ. When the data needs fewer
 * steps the range grows downward first (not below zero for data that isn't negative), then upward: data between
 * 12,185 and 23,319 gets 5K, 10K, 15K, 20K, 25K.
 */
export function niceTicks(min: number, max: number, count = 5) {
  const ticks = Math.max(2, Math.round(count))
  if (!(max > min)) {
    const pad = Math.abs(min) * 0.1 || 1
    return niceTicks(min - pad, max + pad, ticks)
  }
  for (let power = Math.floor(Math.log10((max - min) / (ticks - 1))) - 1; ; power++) {
    for (const base of [1, 2, 2.5, 5]) {
      const step = base * 10 ** power
      let lo = Math.floor(min / step + 1e-9) * step
      let hi = Math.ceil(max / step - 1e-9) * step
      const steps = Math.round((hi - lo) / step)
      if (steps > ticks - 1) continue
      const missing = ticks - 1 - steps
      const down = min >= 0 ? Math.min(missing, Math.round(lo / step)) : missing
      lo -= down * step
      hi += (missing - down) * step
      const digits = Math.max(0, -power + 1)
      return Array.from({ length: ticks }, (_, i) => Number((lo + i * step).toFixed(digits)))
    }
  }
}

const BAR_TICK_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

/**
 * `count` ticks from 0 in a round step (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 × 10ⁿ) that reach `max`, for axes that
 * start at zero: 27,875 → 0, 6K … 30K. 0, 1, 2 … when `max` isn't positive.
 */
export function barTicks(max: number, count = 6) {
  const intervals = Math.max(1, count - 1)
  if (!(max > 0)) return Array.from({ length: intervals + 1 }, (_, i) => i)
  const raw = max / intervals
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = (BAR_TICK_STEPS.find((s) => s * power >= raw * (1 - 1e-9)) ?? 10) * power
  return Array.from({ length: intervals + 1 }, (_, i) => Number((i * step).toPrecision(12)))
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
export type TimeUnit = "hour" | "day" | "month" | "year"
const TIME_STEPS: [TimeUnit, number][] = [
  ["hour", 1], ["hour", 2], ["hour", 3], ["hour", 6], ["hour", 12],
  ["day", 1], ["day", 2], ["day", 3], ["day", 5], ["day", 7], ["day", 14],
  ["month", 1], ["month", 2], ["month", 3], ["month", 6],
  ["year", 1], ["year", 2], ["year", 5], ["year", 10],
]

/**
 * At most `maxCount` round times between `start` and `end` (ms), in UTC: whole hours (every 1, 2, 3, 6 or 12),
 * midnights (every 1, 2, 3, 5, 7 or 14 days), first days of months (every 1, 2, 3 or 6) or of years. Returns the
 * ticks with the unit they step in, for formatting.
 */
export function timeTicks(start: number, end: number, maxCount = 8): { ticks: number[]; unit: TimeUnit } {
  for (const [unit, every] of TIME_STEPS) {
    const ticks: number[] = []
    if (unit === "hour" || unit === "day") {
      const size = (unit === "hour" ? HOUR : DAY) * every
      for (let t = Math.ceil(start / size) * size; t <= end && ticks.length <= maxCount; t += size) ticks.push(t)
    } else {
      const months = unit === "month" ? every : every * 12
      const first = new Date(start)
      let index = first.getUTCFullYear() * 12 + first.getUTCMonth()
      if (Date.UTC(Math.floor(index / 12), index % 12, 1) < start) index++
      index = Math.ceil(index / months) * months
      for (let t = Date.UTC(Math.floor(index / 12), index % 12, 1); t <= end && ticks.length <= maxCount; index += months, t = Date.UTC(Math.floor(index / 12), index % 12, 1))
        ticks.push(t)
    }
    if (ticks.length <= maxCount) return { ticks, unit }
  }
  return { ticks: [], unit: "year" }
}

/**
 * Figma fits the dashes of an open line to whole periods, with half a dash at each end: the stroke-dasharray and
 * stroke-dashoffset that draw `dash` / `gap` that way along a line of `length` px.
 */
export function fittedDash(length: number, dash = 4, gap = 4) {
  const periods = Math.max(1, Math.round(length / (dash + gap)))
  const scale = length / (periods * (dash + gap))
  return { strokeDasharray: `${round(dash * scale)} ${round(gap * scale)}`, strokeDashoffset: round((dash * scale) / 2) }
}

const round = (n: number) => Math.round(n * 1000) / 1000

/**
 * Figma's gradientTransform ([[a, b, c], [d, e, f]]: the node's 0–1 box → gradient space, where the gradient runs along
 * x from 0 to 1) as the gradientTransform of an SVG objectBoundingBox gradient from (0, 0) to (1, 0): its inverse.
 */
export function figmaGradientTransform([[a, b, c], [d, e, f]]: number[][]) {
  const det = a * e - b * d
  return `matrix(${e / det} ${-d / det} ${-b / det} ${a / det} ${(b * f - c * e) / det} ${(c * d - a * f) / det})`
}

/** A Figma four-point star (inner radius 30%) around (x, y), `rx` and `ry` its half width and half height. */
export function starPath({ x, y, rx, ry }: { x: number; y: number; rx: number; ry: number }) {
  const ix = rx * 0.3 * Math.SQRT1_2
  const iy = ry * 0.3 * Math.SQRT1_2
  return `M${x} ${y - ry}L${x + ix} ${y - iy}L${x + rx} ${y}L${x + ix} ${y + iy}L${x} ${y + ry}L${x - ix} ${y + iy}L${x - rx} ${y}L${x - ix} ${y - iy}Z`
}

/** A Figma triangle turned upside down (its point at the bottom), filling the box `rx` and `ry` either side of (x, y). */
export function trianglePath({ x, y, rx, ry }: { x: number; y: number; rx: number; ry: number }) {
  return `M${round(x - rx)} ${round(y - ry)}L${round(x + rx)} ${round(y - ry)}L${x} ${round(y + ry)}Z`
}

/**
 * A seeded pseudo-random generator (mulberry32): numbers in [0, 1) that look random but repeat for the same seed, so
 * generated sample data is the same on the server and in the browser.
 */
export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * `count` sample values (two decimals) that wander with some momentum from `from` to `to`, at most about `swing` off
 * the straight way between them, the same for the same `seed` (seededRandom).
 */
export function bridgeWalk(seed: number, count: number, from: number, to: number, swing: number) {
  const random = seededRandom(seed)
  const walk: number[] = []
  let level = 0
  let drift = 0
  for (let i = 0; i < count; i++) {
    drift = drift * 0.6 + (random() - 0.5)
    level += drift
    walk.push(level)
  }
  const t = (i: number) => (count > 1 ? i / (count - 1) : 1)
  const noise = walk.map((w, i) => w - walk[0] - (walk[count - 1] - walk[0]) * t(i))
  const range = Math.max(...noise) - Math.min(...noise) || 1
  return noise.map((n, i) => Math.round((from + (to - from) * t(i) + (n / range) * swing) * 100) / 100)
}