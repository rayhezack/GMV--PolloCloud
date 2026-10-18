import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/* ══ Stacked bars ═════════════════════════════════════════
   A compact stacked-bar plot for the metric cards. The column under the
   pointer gets a ring round its whole stack, the rest step back by mixing
   their colour toward the card surface, and one tooltip sits beside the
   active bar instead of at a fixed corner.

   The plot owns the hover interaction so all cards get the same behaviour:
   tooltip placement, selected ring, de-emphasis and spacing stay in sync. */

export type StackedBarsDatum = {
  label: string;
  short?: string;
  values: number[];
};

type StackedBarsProps = {
  data: readonly StackedBarsDatum[];
  categories: readonly string[];
  colors: readonly string[];
  formatValue?: (value: number) => string;
  gap?: number;
  isVisible?: boolean;
  ariaLabel?: string;
};

export function StackedBars({
  data,
  categories,
  colors,
  formatValue = (value) => Math.round(value).toLocaleString('en-US'),
  gap = 8,
  isVisible = true,
  ariaLabel = '堆叠柱状图',
}: StackedBarsProps) {
  const [at, setAt] = useState<number | null>(null);
  const [seen, setSeen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();

  /* grow in once, the first time the card is on screen */
  useEffect(() => {
    const element = root.current;
    if (!element || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setSeen(true);
        observer.disconnect();
      }
    }, { threshold: 0.3 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);

  const totals = useMemo(
    () => data.map((item) => item.values.reduce((sum, value) => sum + value, 0)),
    [data],
  );
  const maxTotal = Math.max(1, ...totals);
  const current = at === null ? null : data[at] ?? null;
  const currentTotal = at === null ? 0 : totals[at] ?? 0;
  const activeCategories = current
    ? current.values
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, Math.max(3, Math.min(categories.length, 4)))
    : [];
  const activeCenter = at === null || data.length === 0
    ? 0
    : ((at + 0.5) / data.length) * 100;
  const tooltipTransform = activeCenter < 20
    ? 'translateX(0)'
    : activeCenter > 80
      ? 'translateX(-100%)'
      : 'translateX(-50%)';
  const stackGap = Math.max(4, Math.min(18, gap));

  return (
    <div
      ref={root}
      className="stb stb-chart"
      data-scrub={current ? '' : undefined}
      aria-label={ariaLabel}
      style={{ '--stb-gap': `${stackGap}px` } as CSSProperties}
    >
      <div className="stb-plot">
        <div className="stb-columns">
          {data.map((item, index) => {
            const total = totals[index] ?? 0;
            const stackHeight = Math.max(8, total / maxTotal * 100);
            return (
              <button
                key={`${item.label}-${index}`}
                type="button"
                className="stb-column"
                data-on={at === index || undefined}
                aria-label={`${item.label} ${formatValue(total)}`}
                onPointerEnter={() => setAt(index)}
                onPointerMove={() => setAt(index)}
                onFocus={() => setAt(index)}
                onPointerLeave={() => setAt(null)}
                onPointerCancel={() => setAt(null)}
                onBlur={() => setAt(null)}
              >
                <span className="stb-stack-wrap" style={{ height: `${stackHeight}%` }}>
                  <span className="stb-stack">
                    {item.values.map((value, categoryIndex) => (
                      <motion.span
                        key={`${item.label}-${categories[categoryIndex] ?? categoryIndex}`}
                        className="stb-segment"
                        style={{
                          '--stb-bar-color': colors[categoryIndex % Math.max(colors.length, 1)] ?? 'var(--ui-purple)',
                          height: `${Math.max(3, value / Math.max(total, 1) * 100)}%`,
                        } as CSSProperties}
                        initial={reducedMotion ? false : { scaleY: 0, opacity: 0 }}
                        animate={seen && isVisible || reducedMotion ? { scaleY: 1, opacity: 1 } : { scaleY: 0, opacity: 0 }}
                        transition={reducedMotion ? { duration: 0 } : { duration: 0.55, delay: index * 0.025 + categoryIndex * 0.035, ease: 'easeOut' }}
                      />
                    ))}
                  </span>
                  {at === index && <span className="stb-ring" aria-hidden="true" />}
                </span>
                <span className="stb-column-label">{index === 0 || index === data.length - 1 ? (item.short ?? item.label) : ''}</span>
              </button>
            );
          })}
        </div>

        {current && (
          <div
            className="stb-tip"
            role="status"
            style={{ left: `${activeCenter}%`, transform: tooltipTransform }}
          >
            <div className="stb-tip-head">
              <span>{current.label}</span>
              <b>{formatValue(currentTotal)}</b>
            </div>
            {activeCategories.map(({ value, index }) => (
              <div className="stb-tip-row" key={categories[index] ?? index}>
                <i style={{ '--stb-bar-color': colors[index % Math.max(colors.length, 1)] ?? 'var(--ui-purple)' } as CSSProperties} />
                <span>{categories[index] ?? `维度 ${index + 1}`}</span>
                <b>{formatValue(value)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
