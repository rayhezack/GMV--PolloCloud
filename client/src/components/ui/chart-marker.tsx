import * as React from 'react';

import { cn } from '@/lib/utils';

// Figma's 2px inside stroke with an angular gradient, starting at 6 o'clock
const RING =
  'bg-[conic-gradient(from_180deg,#fafafa_0deg,#fafafa_41.33deg,#e3e3e3_64.88deg,#fafafa_97.81deg,#fafafa_222.22deg,#e3e3e3_254.91deg,#fafafa_285.04deg,#fafafa_360deg)]';

/**
 * The 12px marker of the Keitoto line charts: the series colour (the --marker-color CSS variable, blue-500 unless set:
 * `[--marker-color:var(--primary-green-500)]`) inside a 2px light ring, with two soft drop shadows. It is the marker
 * only: place it yourself (absolute, centred on the point).
 */
function ChartMarker({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      data-slot="chart-marker"
      className={cn(
        'inline-flex size-3 shrink-0 rounded-full p-0.5 [--marker-color:var(--primary-blue-500)]',
        // Figma paints later effects on top; CSS paints the first shadow on top
        'shadow-[0_1px_4px_rgb(0_0_0/0.06),0_2px_8px_rgb(0_0_0/0.12)]',
        RING,
        className,
      )}
      {...props}
    >
      <span
        data-slot="chart-marker-dot"
        className="size-full rounded-full bg-(--marker-color) transition-[background-color] duration-200"
      />
    </span>
  );
}

export { ChartMarker };
