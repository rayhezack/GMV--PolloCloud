import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ── Action node ───────────────────────────────────────────
   The controls are the component. The card stays quiet until
   the pointer asks for the actions, then the controls travel
   out of the corner they belong to instead of appearing in an
   unrelated floating menu.

   The original Bencho node uses one spring per action. This
   dashboard only needs the same spatial cue, so the stagger is
   expressed by CSS transition delays and remains small enough
   to feel like one fan rather than a list entering in order.
*/

export type ActionNodeAction = {
  id: string;
  label: string;
  Icon: LucideIcon;
  href?: string;
  onSelect?: () => void;
};

export function ActionNode({
  children,
  actions,
  rangeOptions,
  selectedRange,
  onRangeChange,
  rangeIcon: RangeIcon,
  rangeLabel = '选择趋势范围',
  className,
  ariaLabel = '更多操作',
}: {
  children: ReactNode;
  actions: ActionNodeAction[];
  rangeOptions?: Array<{ value: number; label: string }>;
  selectedRange?: number;
  onRangeChange?: (value: number) => void;
  rangeIcon?: LucideIcon;
  rangeLabel?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const fanRef = useRef<HTMLDivElement | null>(null);
  const visibleActions = actions.slice(0, 5);
  useEffect(() => {
    if (!open && !rangeOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!nodeRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setRangeOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open, rangeOpen]);

  return (
    <div
      ref={nodeRef}
      className={cn('action-node', className)}
      data-open={open || undefined}
      onPointerMove={(event) => {
        if (event.target instanceof Element && event.target.closest('.action-node-range')) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const inCorner = event.clientX >= bounds.right - 88 && event.clientY <= bounds.top + 76;
        const fan = fanRef.current?.getBoundingClientRect();
        const inFan = open && fan && event.clientX >= fan.left - 8 && event.clientX <= fan.right + 8 && event.clientY >= fan.top - 8 && event.clientY <= fan.bottom + 12;
        if (inCorner || inFan) {
          setOpen(true);
        } else {
          setOpen(false);
          setRangeOpen(false);
        }
      }}
      onFocusCapture={() => setOpen(true)}
      onPointerLeave={() => {
        setOpen(false);
        setRangeOpen(false);
      }}
    >
      <div className="action-node-content">{children}</div>
      <div ref={fanRef} className="action-node-fan" aria-label={ariaLabel}>
        {visibleActions.map((action, index) => {
          const Icon = action.Icon;
          const content = (
            <>
              <Icon size={15} strokeWidth={2} />
              <span className="sr-only">{action.label}</span>
              <span className="action-node-tooltip" role="tooltip">{action.label}</span>
            </>
          );
          const props = {
            className: 'action-node-action',
            'aria-label': action.label,
            tabIndex: open ? 0 : -1,
            style: { '--action-node-index': index } as React.CSSProperties,
            onClick: action.onSelect,
          };

          return action.href ? (
            <Link key={action.id} {...props} to={action.href}>
              {content}
            </Link>
          ) : (
            <button key={action.id} {...props} type="button">
              {content}
            </button>
          );
        })}
        {RangeIcon && rangeOptions?.length && onRangeChange ? (
          <button
            type="button"
            className="action-node-action action-node-range-trigger"
            aria-label={rangeLabel}
            tabIndex={open ? 0 : -1}
            onPointerEnter={() => setRangeOpen(true)}
            onFocus={() => setRangeOpen(true)}
            onClick={() => setRangeOpen((current) => !current)}
            style={{ '--action-node-index': visibleActions.length } as React.CSSProperties}
          >
            <RangeIcon size={15} strokeWidth={2} />
            <span className="sr-only">{rangeLabel}</span>
          </button>
        ) : null}
      </div>
      {rangeOptions?.length && onRangeChange ? (
        <div
          className="action-node-range"
          data-range-open={rangeOpen || undefined}
          role="group"
          aria-label="趋势范围"
          onPointerEnter={() => setRangeOpen(true)}
          onPointerLeave={() => setRangeOpen(false)}
        >
          {rangeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="action-node-range-option"
              data-active={selectedRange === option.value || undefined}
              tabIndex={rangeOpen ? 0 : -1}
              onClick={() => {
                onRangeChange(option.value);
                setRangeOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
