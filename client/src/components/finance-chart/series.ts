type Point = { x: number; y: number };
export function linePath(points: Point[]) {
  return points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
}
export function valueAt(points: Point[], x: number) {
  if (!points.length) return 0;
  for (let i = 1; i < points.length; i++)
    if (x <= points[i].x) {
      const a = points[i - 1],
        b = points[i];
      return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
    }
  return points.at(-1)!.y;
}
// Monotone Hermite slopes; turns stay flat rather than overshooting actual data.
export function smoothTangents(p: Point[]) {
  if (p.length < 2) return p.map(() => 0);
  const s = p.slice(1).map((b, i) => (b.y - p[i].y) / (b.x - p[i].x || 1));
  return p.map((_, i) =>
    i === 0
      ? s[0]
      : i === p.length - 1
        ? s.at(-1)!
        : s[i - 1] * s[i] <= 0
          ? 0
          : 2 / (1 / s[i - 1] + 1 / s[i]),
  );
}
export function niceTicks(min: number, max: number, count = 5) {
  const raw = (max - min) / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1));
  const step =
    [1, 2, 2.5, 5, 10].map((v) => v * magnitude).find((v) => v >= raw) ||
    magnitude * 10;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
}
export function fittedDash(length: number, dash: number, gap: number) {
  const n = Math.max(1, Math.round(length / (dash + gap)));
  const scale = length / (n * (dash + gap));
  return {
    strokeDasharray: `${dash * scale} ${gap * scale}`,
    strokeDashoffset: (dash * scale) / 2,
  };
}
export function alignPolylines(
  a: Point[],
  b: Point[],
  count: number,
  curve: (p: Point[]) => (x: number) => number,
) {
  const lo = Math.min(a[0].x, b[0].x),
    hi = Math.max(a.at(-1)!.x, b.at(-1)!.x);
  const xs = Array.from(
    { length: count },
    (_, i) => lo + ((hi - lo) * i) / (count - 1),
  );
  return { xs, from: xs.map(curve(a)), to: xs.map(curve(b)) };
}
