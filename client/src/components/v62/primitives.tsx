import { useId, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { WorkbenchIcon, type WorkbenchIconName } from '../icons/WorkbenchIcon';
import './spring-segment.css';
export { InfoTip as Definition } from '../system/InfoTip';
export { money as usd, signedMoney as signedUsd, share as pct } from '../../../../shared/format';
export { DeltaBadge as Delta } from '../system/DeltaBadge';
export function Segment<T extends string>({
  items,
  value,
  onChange,
  label,
  variant = 'compact',
}: {
  items: readonly { value: T; label: string; icon?: WorkbenchIconName }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  variant?: 'compact' | 'icons' | 'liquid';
}) {
  const id = useId();
  const reduced = useReducedMotion();
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? (index + 1) % items.length
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
              ? (index + items.length - 1) % items.length
              : null;
    if (next == null) return;
    event.preventDefault();
    onChange(items[next].value);
    (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="spring-segment" data-variant={variant}>
      {items.map((item, index) => (
        <button
          type="button"
          role="radio"
          key={item.value}
          aria-checked={item.value === value}
          tabIndex={item.value === value ? 0 : -1}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => move(event, index)}
        >
          {item.value === value && (
            <motion.span
              className="spring-segment-pill"
              layoutId={`segment-${id}`}
              transition={
                reduced
                  ? { duration: 0 }
                  : {
                      type: 'spring',
                      stiffness: variant === 'liquid' ? 170 : 380,
                      damping: variant === 'liquid' ? 21.5 : 29,
                      mass: 0.9,
                    }
              }
            />
          )}
          <span className="spring-segment-label">
            {item.icon && <WorkbenchIcon name={item.icon} active={item.value === value} />}
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
}

export function exportCsv(name: string, rows: (string | number | null)[][]) {
  const body =
    '\uFEFF' +
    rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
