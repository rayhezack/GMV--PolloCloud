import * as React from "react"

import { ArrowCircleDownIcon, ArrowCircleUpIcon } from "@/components/ui/chart-icons"
import { cn } from "@/lib/utils"

type ChartChangeBadgeProps = Omit<React.ComponentProps<"span">, "children"> & {
  /** The change. Zero or more is green with an arrow up, less than zero red with an arrow down. */
  value: number
  /** Formats the value for the badge ("2.4%", "$1,637"). */
  format: (value: number) => string
  /** The value's span, to count it with useCountUp. */
  valueRef?: React.Ref<HTMLSpanElement>
  /** Classes for the value's span (Label/01 Medium). */
  valueClassName?: string
}

/**
 * Figma "Change Badge": a Primary/Green/green-50 pill with an arrow-circle-up and the change in green-500, or
 * Error/error-50 with an arrow-circle-down and the change in error-500 for a fall; the colours cross-fade when the sign
 * flips. A screen reader hears "Up" or "Down" before the change.
 */
function ChartChangeBadge({ value, format, valueRef, valueClassName, className, ...props }: ChartChangeBadgeProps) {
  const down = value < 0
  const Arrow = down ? ArrowCircleDownIcon : ArrowCircleUpIcon
  return (
    <span
      data-slot="chart-change-badge"
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 transition-colors duration-300 motion-reduce:transition-none",
        down ? "bg-error-50 text-error-500" : "bg-primary-green-50 text-primary-green-500",
        className,
      )}
      {...props}
    >
      <Arrow className="shrink-0" />
      <span className="sr-only">{down ? "Down" : "Up"}</span>
      <span ref={valueRef} className={cn("typo-label-01-medium hug-w", valueClassName)}>
        {format(value)}
      </span>
    </span>
  )
}

export { ChartChangeBadge, type ChartChangeBadgeProps }