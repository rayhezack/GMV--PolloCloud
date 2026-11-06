const KAPPA = 0.5522847498 // Figma rounds a corner with a cubic whose handles are this share of the radius

const round = (n: number) => Math.round(n * 1000) / 1000

export type SectorOptions = {
  /** The ring's centre, (center, center): half the side of its square box. */
  center: number
  /** Figma's corner radius, measured along each edge from the corner; 0 (square corners) by default. */
  corner?: number
}

/**
 * The ring segment from radius r0 to r1 between angles a0 and a1, its corners rounded the way Figma rounds an arc's:
 * each corner starts `corner` px from it along both edges (an arc length on the arcs) and is a cubic with handles of
 * 0.55 × the radius, the radius held to half the segment's length and width. Empty when the segment has no width or
 * no angle.
 */
export function sectorPath(r0: number, r1: number, a0: number, a1: number, { center, corner = 0 }: SectorOptions) {
  if (!(r1 - r0 > 0.01) || !(a1 > a0)) return ""
  const polar = (r: number, a: number): [number, number] => [center + r * Math.sin(a), center - r * Math.cos(a)]
  const c = Math.max(0, Math.min(corner, (r1 - r0) / 2, (r0 * (a1 - a0)) / 2))
  const k = KAPPA * c
  const along = (p: [number, number], a: number, d: number): [number, number] => [p[0] + d * Math.cos(a), p[1] + d * Math.sin(a)]
  const at = (p: [number, number]) => `${round(p[0])} ${round(p[1])}`
  const q1 = polar(r1 - c, a0)
  const q2a = a0 + c / r1
  const q2 = polar(r1, q2a)
  const q3a = a1 - c / r1
  const q3 = polar(r1, q3a)
  const q4 = polar(r1 - c, a1)
  const q5 = polar(r0 + c, a1)
  const q6a = a1 - c / r0
  const q6 = polar(r0, q6a)
  const q7a = a0 + c / r0
  const q7 = polar(r0, q7a)
  const q8 = polar(r0 + c, a0)
  const big = (from: number, to: number) => (to - from > Math.PI ? 1 : 0)
  return [
    `M ${at(q1)}`,
    `C ${at(polar(r1 - c + k, a0))} ${at(along(q2, q2a, -k))} ${at(q2)}`,
    `A ${round(r1)} ${round(r1)} 0 ${big(q2a, q3a)} 1 ${at(q3)}`,
    `C ${at(along(q3, q3a, k))} ${at(polar(r1 - c + k, a1))} ${at(q4)}`,
    `L ${at(q5)}`,
    `C ${at(polar(r0 + c - k, a1))} ${at(along(q6, q6a, k))} ${at(q6)}`,
    `A ${round(r0)} ${round(r0)} 0 ${big(q7a, q6a)} 0 ${at(q7)}`,
    `C ${at(along(q7, q7a, -k))} ${at(polar(r0 + c - k, a0))} ${at(q8)}`,
    "Z",
  ].join(" ")
}