import { useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

type Indicator = { x: number; width: number };

/* Adapted from Bencho's Icon bar, with text labels for dashboard filters.
   Same two phase indicator as the segmented pill: the leading edge runs
   ahead, the pill dilates across both slots, then the trailing edge catches
   up and overshoots on landing. Selection itself is controlled by the caller. */
export function IconBar<T extends string>({ items, value, onChange, label }: {
  items: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const previous = useRef<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [indicator, setIndicator] = useState<Indicator | null>(null);
  const [phase, setPhase] = useState<'idle' | 'stretch' | 'settle'>('idle');
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const group = track.current;
    if (!group) return;
    const selected = group.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!selected) return;
    const measure = () => ({ x: selected.offsetLeft, width: selected.offsetWidth });
    const to = measure();
    clearTimeout(timer.current);
    if (previous.current === null || previous.current === value || reducedMotion || !pill.current) {
      setPhase('idle');
      setIndicator(to);
    } else {
      // Measure the painted pill, so rapid reversals continue from its current
      // position instead of restarting from an obsolete selected slot.
      const bounds = group.getBoundingClientRect();
      const painted = pill.current.getBoundingClientRect();
      const start = Math.min(painted.left - bounds.left, to.x);
      const end = Math.max(painted.right - bounds.left, to.x + to.width);
      setPhase('stretch');
      setIndicator({ x: start, width: end - start });
      // The handoff shares the original clock: 190ms stretch, handoff at
      // 150ms, then 420ms settle with separate move/size overshoot curves.
      timer.current = setTimeout(() => {
        setPhase('settle');
        setIndicator(measure());
      }, 150);
    }
    previous.current = value;
    let width = group.getBoundingClientRect().width;
    const resize = () => {
      const nextWidth = group.getBoundingClientRect().width;
      if (nextWidth === width) return;
      width = nextWidth;
      clearTimeout(timer.current);
      setPhase('idle');
      setIndicator(measure());
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(group);
    window.addEventListener('resize', resize);
    return () => {
      clearTimeout(timer.current);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [value, reducedMotion]);

  return (
    <div ref={track} className="chain-icon-bar" role="group" aria-label={label}>
      <span ref={pill} className="chain-icon-bar-indicator" data-phase={phase} aria-hidden="true"
        style={indicator ? { transform: `translate3d(${indicator.x}px, 0, 0)`, width: indicator.width } : { opacity: 0 }} />
      {items.map((item) => (
        <button key={item.value} type="button" aria-pressed={value === item.value}
          onClick={() => { if (value !== item.value) onChange(item.value); }}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
