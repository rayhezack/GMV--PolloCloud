import { useEffect, useRef, useState, type CSSProperties } from 'react';

/* One object, not an icon swapped for an input. Width is the state;
   the lens stays at the same inset while the field grows around it. */
const SHUT = 34;
const LENS = 16;
const INSET = (SHUT - LENS) / 2;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/* Frames rather than milliseconds: damping raised to dt keeps the spring
   consistent after a dropped frame. The loop stops once it has settled. */
function useSpring(target: number, instant: boolean) {
  const [at, setAt] = useState(target);
  const current = useRef(target);
  const velocity = useRef(0);
  useEffect(() => {
    if (instant) {
      current.current = target;
      velocity.current = 0;
      setAt(target);
      return;
    }
    let raf = 0;
    let previous = 0;
    const tick = (time: number) => {
      const dt = previous ? clamp((time - previous) / 16.67, 0, 2.5) : 1;
      previous = time;
      velocity.current += (target - current.current) * 0.16 * dt;
      velocity.current *= Math.pow(0.75, dt);
      current.current += velocity.current * dt;
      if (Math.abs(target - current.current) < 0.02 && Math.abs(velocity.current) < 0.02) {
        current.current = target;
        velocity.current = 0;
        setAt(target);
        return;
      }
      setAt(current.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, instant]);
  return at;
}

type SearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number;
};

export function Search({ value, onChange, placeholder = '搜索', width = 240 }: SearchProps) {
  const [open, setOpen] = useState(Boolean(value));
  const [pressed, setPressed] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const beat = useRef(0);
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const span = Math.max(SHUT, width);
  const animatedWidth = useSpring(open ? span : SHUT, Boolean(still));
  const progress = clamp((animatedWidth - SHUT) / (span - SHUT || 1), 0, 1);

  useEffect(() => () => window.clearTimeout(beat.current), []);
  const expand = () => {
    if (open) return;
    setPressed(true);
    window.clearTimeout(beat.current);
    beat.current = window.setTimeout(() => {
      setPressed(false);
      setOpen(true);
      input.current?.focus();
    }, still ? 0 : 90);
  };

  return (
    <div className="bencho-search" data-open={open} data-press={pressed} style={{ '--w': `${animatedWidth.toFixed(2)}px`, '--say': clamp((progress - .55) / .45, 0, 1).toFixed(3), '--inset': `${INSET}px`, '--lens': `${LENS}px` } as CSSProperties}>
      <div className="bencho-search-skin">
        <svg className="bencho-search-lens" viewBox="0 0 18 18" aria-hidden="true"><circle cx="7.6" cy="7.6" r="5.4" /><path d="M11.6 11.6 L15.4 15.4" /></svg>
        <input
          ref={input}
          type="search"
          className="bencho-search-field"
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          tabIndex={open ? 0 : -1}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => { if (!value.trim()) setOpen(false); }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            onChange('');
            setOpen(false);
            input.current?.blur();
          }}
        />
        {!open && <button type="button" className="bencho-search-hit" aria-label={placeholder} onClick={expand} />}
      </div>
    </div>
  );
}
