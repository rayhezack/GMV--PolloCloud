import * as React from "react"

import { cn } from "@/lib/utils"

// The two swatches Figma draws: the 14px one of most legends and the 10px one of the Trends cards, whose corners,
// ring, inside stroke and shadows are scaled down with it. The 14px stroke follows a size-* class; the 10px one is
// drawn at 10px.
const SIZES = {
  14: {
    size: "size-3.5",
    corners: "rounded-[4.667px]",
    // Figma paints later effects on top; CSS paints the first shadow on top
    shadow: "shadow-[0_7.2px_14.4px_-3.6px_rgb(38_45_58/0.2),0_0_0_1.167px_var(--swatch-ring),inset_0_-3.6px_7.2px_-3.6px_rgb(0_0_0/0.05)]",
    rect: { x: "0.583", y: "0.583", rx: "4.083" },
    stroke: 1.167,
    style: { width: "calc(100% - 1.167px)", height: "calc(100% - 1.167px)" },
  },
  10: {
    size: "size-2.5",
    corners: "rounded-[3px]",
    shadow: "shadow-[0_5.142px_10.284px_-2.571px_rgb(38_45_58/0.2),0_0_0_0.714px_var(--swatch-ring),inset_0_-2.571px_5.142px_-2.571px_rgb(0_0_0/0.05)]",
    rect: { x: "0.357", y: "0.357", width: "9.286", height: "9.286", rx: "2.643" },
    stroke: 0.714,
    style: undefined,
  },
} as const

type ChartLegendSwatchProps = React.ComponentProps<"span"> & {
  /** 14 (the default) or 10: the Trends cards' swatch, with 3px corners and a 0.71px ring and stroke. */
  size?: 14 | 10
}

/**
 * The legend swatch of the Keitoto chart cards: 14px with 4.67px corners, a 1.17px ring (its colour is the
 * --swatch-ring CSS variable, transparent unless set: `[--swatch-ring:#3a5eff]`), a soft drop shadow, a faint inner
 * shadow along the bottom and a white inside stroke that fades out downward. `size={10}` is the 10px swatch of the
 * Trends cards. Set the fill with a background class.
 */
function ChartLegendSwatch({ size = 14, className, ...props }: ChartLegendSwatchProps) {
  const s = SIZES[size]
  // useId() may contain characters that don't belong in a url(#…) reference
  const gradient = `chart-legend-swatch-${React.useId().replace(/[^\w-]/g, "")}`
  return (
    <span
      aria-hidden
      data-slot="chart-legend-swatch"
      className={cn(
        "relative inline-block",
        s.size,
        "shrink-0 overflow-hidden",
        s.corners,
        "bg-primary-blue-500 [--swatch-ring:transparent] transition-[background-color,box-shadow] duration-200",
        s.shadow,
        className,
      )}
      {...props}
    >
      {/* Figma: the inside stroke, white at 24% fading out toward the bottom (an SVG stroke, so it anti-aliases like Figma's) */}
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity={0.24} />
            <stop offset="1" stopColor="#fff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <rect {...s.rect} fill="none" stroke={`url(#${gradient})`} strokeWidth={s.stroke} style={s.style} />
      </svg>
    </span>
  )
}

export { ChartLegendSwatch, type ChartLegendSwatchProps }