"use client"

import * as React from "react"

import { ChartLegendSwatch } from "@/components/ui/chart-legend-swatch"
import { useCountUp } from "@/hooks/use-chart-motion"

type ChartTrendsTooltipRow = {
  id: string
  label: React.ReactNode
  value: number
  /** The classes of the row's 10px ChartLegendSwatch: its fill and its ring (`bg-primary-blue-500 [--swatch-ring:#3a5eff]`). */
  swatch: string
}

type ChartTrendsTooltipContentProps = {
  /** The first line, on Background/Disable ("May 17 – 28, 2026"). */
  date: React.ReactNode
  rows: ChartTrendsTooltipRow[]
  /** Formats the amounts. */
  format: (value: number) => string
  /** Count the amounts from the previous ones when they change: on in the tooltip, off in a measured copy. */
  counting?: boolean
}

/** A tooltip amount, counting from the previous one when it changes. */
function ChartTrendsTooltipValue({ value, format }: { value: number; format: (value: number) => string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useCountUp(ref, value, format, { duration: 450 })
  return (
    <span ref={ref} data-slot="chart-trends-tooltip-value" data-value={value} className="typo-label-03-medium hug-w whitespace-nowrap text-fg-loud">
      {format(value)}
    </span>
  )
}

/**
 * What the tooltip of the Trends cards holds: the date on Background/Disable, then a row per series (its 10px swatch,
 * its name and the amount), the names in a column at least 100px wide so the amounts line up. Put it in your tooltip
 * box (a column 8px apart); it has no box of its own, so the same content can be rendered again, invisible, to measure
 * the tooltip while its amounts count.
 */
function ChartTrendsTooltipContent({ date, rows, format, counting = false }: ChartTrendsTooltipContentProps) {
  return (
    <>
      <span data-slot="chart-trends-tooltip-date" className="flex items-center rounded-lg bg-surface-disable p-2">
        <span className="typo-label-02-medium hug-w whitespace-nowrap text-fg-loud">{date}</span>
      </span>
      <span data-slot="chart-trends-tooltip-rows" className="grid grid-cols-[auto_minmax(100px,max-content)_max-content] items-center gap-x-1.5 gap-y-2.5 px-2 pt-0.5 pb-1.5">
        {rows.map((row) => (
          <React.Fragment key={row.id}>
            <ChartLegendSwatch size={10} className={row.swatch} />
            <span className="typo-label-02-regular hug-w whitespace-nowrap text-fg-soft">{row.label}</span>
            {counting ? (
              <ChartTrendsTooltipValue value={row.value} format={format} />
            ) : (
              <span className="typo-label-03-medium hug-w whitespace-nowrap">{format(row.value)}</span>
            )}
          </React.Fragment>
        ))}
      </span>
    </>
  )
}

export { ChartTrendsTooltipContent, type ChartTrendsTooltipContentProps, type ChartTrendsTooltipRow }