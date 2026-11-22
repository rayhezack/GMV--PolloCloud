import { useId, useRef, useState, type CSSProperties } from 'react';
import { ChartCard } from '@/components/ui/chart-card';
import { releaseStyles, useChartEntrance } from '@/hooks/use-chart-motion';
import { money, rate } from '@shared/format';
import { cn } from '@/lib/utils';
import './budget-chart.css';

export type BudgetSegment = { id: string; label: string; amount: number; color: string };
type BudgetChartProps = {
  title: string;
  date: string;
  total: number;
  segments: BudgetSegment[];
  className?: string;
};

/**
 * Adapted from mebius charts-budget (Budget Chart, Figma 1473:76306).
 * Retains ChartCard, anime.js staggered meter entrance and pointer/keyboard inspection.
 * The budget/limit meter is a categorical composition strip: exact segment widths,
 * no spending limit, sample figures, budget advice or decorative empty remainder.
 */
export function BudgetChart({ title, date, total, segments, className }: BudgetChartProps) {
  const root = useRef<HTMLDivElement>(null);
  const [inspected, setInspected] = useState<string | null>(null);
  const tooltipId = useId();
  const active = segments.find((segment) => segment.id === inspected);
  const stackable = total > 0 && segments.every((segment) => segment.amount >= 0);
  const activeIndex = segments.findIndex((segment) => segment.id === inspected);
  const tooltipPosition =
    stackable && active
      ? ((segments.slice(0, activeIndex).reduce((sum, segment) => sum + segment.amount, 0) + active.amount / 2) /
          total) *
        100
      : 50;
  useChartEntrance(
    root,
    (timeline) => {
      const bars = Array.from(root.current?.querySelectorAll('[data-slot="budget-chart-segment"]') ?? []);
      if (bars.length)
        timeline.add(bars, {
          opacity: { from: 0 },
          scaleX: { from: 0.6 },
          duration: 550,
          ease: 'outCubic',
          delay: (_: unknown, index: number) => index * 45,
          onComplete: releaseStyles('opacity', 'transform'),
        });
    },
    { mode: 'timeline' },
  );

  return (
    <ChartCard ref={root} className={cn('budget-composition', className)} role="region" aria-label={title}>
      <header className="budget-composition-header">
        <div>
          <h2>{title}</h2>
          <time dateTime={date}>{date.slice(5).replace('-', '/')}</time>
        </div>
        <strong>{money(total)}</strong>
      </header>
      <div className="budget-composition-plot">
        <div
          className="budget-composition-meter"
          aria-label="付费类型金额占比"
          role="group"
          onPointerLeave={() => setInspected(null)}
        >
          {stackable &&
            segments.map((segment) => (
              <span
                key={segment.id}
                data-slot="budget-chart-segment"
                data-active={active ? segment.id === active.id : undefined}
                style={
                  { width: `${(segment.amount / total) * 100}%`, '--segment-color': segment.color } as CSSProperties
                }
                onPointerEnter={() => setInspected(segment.id)}
              />
            ))}
        </div>
        {active && (
          <div
            id={tooltipId}
            role="tooltip"
            className="budget-composition-tooltip"
            style={{ left: `clamp(80px, ${tooltipPosition}%, calc(100% - 80px))` }}
          >
            <span>{active.label}</span>
            <div>
              <strong>{money(active.amount)}</strong>
              <span>{total > 0 ? rate(active.amount / total) : '—'}</span>
            </div>
          </div>
        )}
      </div>
      {!stackable && (
        <p className="budget-composition-empty">{total === 0 ? '当日 GMV 为零' : '包含负向金额，悬浮图例查看构成'}</p>
      )}
      <ul className="budget-composition-legend" onPointerLeave={() => setInspected(null)}>
        {segments.map((segment) => (
          <li key={segment.id}>
            <button
              type="button"
              data-active={active?.id === segment.id || undefined}
              aria-label={`${segment.label}，${money(segment.amount)}，占比${total > 0 ? rate(segment.amount / total) : '不可计算'}`}
              aria-describedby={active?.id === segment.id ? tooltipId : undefined}
              onPointerEnter={() => setInspected(segment.id)}
              onFocus={() => setInspected(segment.id)}
              onBlur={() => setInspected(null)}
              onClick={() => setInspected(segment.id)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setInspected(null);
                }
              }}
            >
              <i style={{ background: segment.color }} aria-hidden="true" />
              <span>{segment.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
