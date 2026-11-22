'use client';

import * as React from 'react';

import { useCountUp } from '@/hooks/use-chart-motion';
import { cn } from '@/lib/utils';

type ChartTickLabelProps = Omit<React.ComponentProps<'span'>, 'children'> & {
  /** The tick's value. */
  value: number;
  /** Formats the value ("$20K", "30%"). */
  format: (value: number) => string;
  /** How long a new value counts from the old one, in ms. */
  duration?: number;
};

/**
 * A y-axis label of the Keitoto line charts (Label/02 Regular, Text/Soft, on one line). When the axis rescales, the
 * label at each place counts from its old tick to the new one.
 */
function ChartTickLabel({ value, format, duration = 650, className, ...props }: ChartTickLabelProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  useCountUp(ref, value, format, { duration });
  return (
    <span
      ref={ref}
      data-slot="chart-tick-label"
      className={cn('typo-label-02-regular whitespace-nowrap text-fg-soft', className)}
      {...props}
    >
      {format(value)}
    </span>
  );
}

export { ChartTickLabel, type ChartTickLabelProps };
