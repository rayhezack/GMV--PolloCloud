import { type CSSProperties, type PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion';

const SPRING = { type: 'spring' as const, stiffness: 380, damping: 34 };
const RING_PAD = 4;
const TIP_GAP = 12; // air outside the ring, not measured from the column centre

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
  const plot = useRef<HTMLDivElement | null>(null);
  const tip = useRef<HTMLDivElement | null>(null);
  const ringX = useMotionValue(0);
  const ringY = useMotionValue(0);
  const ringHeight = useMotionValue(0);
  const ringWidth = useMotionValue(0);
  const tipX = useMotionValue(0);
  const tipY = useMotionValue(0);
  const was = useRef<number | null>(null);
  const tipSide = useRef<'left' | 'right' | null>(null);
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
  const stackGap = Math.max(4, Math.min(18, gap));

  /* ring and tooltip: placed at once when they appear, glide after.
     Keep one ring alive across columns, including the gaps between them. */
  useLayoutEffect(() => {
    const element = plot.current;
    if (!current || at === null || !element) {
      was.current = null;
      tipSide.current = null;
      return;
    }
    const stack = element.querySelectorAll<HTMLElement>('.stb-stack-wrap')[at];
    if (!stack || !tip.current) return;
    let animations: ReturnType<typeof animate>[] = [];
    const position = (immediate = false) => {
      animations.forEach((animation) => animation.stop());
      animations = [];
      const bounds = element.getBoundingClientRect();
      const bar = stack.getBoundingClientRect();
      const tooltip = tip.current!.getBoundingClientRect();
      const right = bar.right + RING_PAD + TIP_GAP;
      const left = bar.left - RING_PAD - TIP_GAP - tooltip.width;
      /* Beside the column: right while it fits, else left. On narrow cards
         the portal can extend past the card instead of covering the bar or
         being clipped by the card's rounded overflow. */
      const side = right + tooltip.width <= bounds.right ? 'right'
        : left >= bounds.left ? 'left'
          : right + tooltip.width <= window.innerWidth - 8 ? 'right' : 'left';
      const snap = immediate || was.current === null || reducedMotion;
      const go = (value: typeof ringX, target: number, instantly = snap) => {
        if (instantly) value.set(target);
        else animations.push(animate(value, target, SPRING));
      };
      go(ringX, bar.left - bounds.left - RING_PAD);
      go(ringY, bar.top - bounds.top - RING_PAD);
      go(ringHeight, bar.height + RING_PAD * 2);
      go(ringWidth, bar.width + RING_PAD * 2);
      // Switching sides must not sweep the tooltip across the selected bar.
      go(tipX, side === 'right' ? right : left, snap || tipSide.current !== side);
      go(tipY, Math.max(8, Math.min(bounds.top, window.innerHeight - tooltip.height - 8)));
      was.current = at;
      tipSide.current = side;
    };
    position();
    const reposition = () => position(true);
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);
      return () => {
        window.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
      };
    }
    let size = element.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect();
      if (next.width !== size.width || next.height !== size.height) reposition();
      size = next;
    });
    observer.observe(element);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      animations.forEach((animation) => animation.stop());
      observer.disconnect();
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [at, current, reducedMotion, ringX, ringY, ringHeight, ringWidth, tipX, tipY]);

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const columns = plot.current?.querySelectorAll<HTMLElement>('.stb-column');
    if (!columns?.length) return;
    let nearest = 0;
    let distance = Infinity;
    columns.forEach((column, index) => {
      const bounds = column.getBoundingClientRect();
      const delta = Math.abs(event.clientX - bounds.left - bounds.width / 2);
      if (delta < distance) { nearest = index; distance = delta; }
    });
    setAt(nearest);
  };

  return (
    <div
      ref={root}
      className="stb stb-chart"
      data-scrub={current ? '' : undefined}
      aria-label={ariaLabel}
      style={{ '--stb-gap': `${stackGap}px` } as CSSProperties}
    >
      <div ref={plot} className="stb-plot" onPointerMove={pick} onPointerDown={pick}
        onPointerLeave={() => setAt(null)} onPointerCancel={() => setAt(null)}
        onPointerUp={(event) => { if (event.pointerType !== 'mouse') setAt(null); }}>
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
                onFocus={() => setAt(index)}
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
                </span>
                <span className="stb-column-label">{index === 0 || index === data.length - 1 ? (item.short ?? item.label) : ''}</span>
              </button>
            );
          })}
        </div>

        <motion.span className="stb-ring" aria-hidden="true"
          style={{ x: ringX, y: ringY, height: ringHeight, width: ringWidth }}
          animate={{ opacity: current ? 1 : 0 }} transition={{ duration: reducedMotion ? 0 : 0.12 }} />

        {current && createPortal(
          <motion.div
            ref={tip}
            className="stb-tip"
            role="status"
            style={{ x: tipX, y: tipY }}
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
          </motion.div>, document.body,
        )}
      </div>
    </div>
  );
}
