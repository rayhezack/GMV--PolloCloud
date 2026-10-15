import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Layers2, Monitor, Plus, Smartphone } from 'lucide-react';
import type { Platform } from '@shared/api.interface';

export type CreateMenuScope = Platform | 'both';

const ITEMS: Array<{ scope: CreateMenuScope; label: string; Icon: typeof Monitor }> = [
  { scope: 'web', label: 'Web 端', Icon: Monitor },
  { scope: 'app', label: 'App 端', Icon: Smartphone },
  { scope: 'both', label: '全端', Icon: Layers2 },
];

/* The menu keeps one opaque surface and one text layer. Its motion is a
   compact version of the Bencho create study: press first, then spread. */
const LIQUID = { type: 'spring' as const, stiffness: 420, damping: 30 };

export function CreateMenu({
  disabled = false,
  busy = false,
  onSelect,
}: {
  disabled?: boolean;
  busy?: boolean;
  onSelect: (scope: CreateMenuScope) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pressed, setPressed] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  /* Close only on a trusted pointer outside the visible panel. */
  useEffect(() => {
    if (!open) return;
    const closeAway = (event: PointerEvent) => {
      if (!event.isTrusted || root.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeAway);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeAway);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const press = () => {
    if (disabled || busy) return;
    setPressed(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setPressed(false);
      setOpen(true);
    }, 70);
  };

  return (
    <div ref={root} className="create-menu-root" data-open={open || undefined} data-pressed={pressed || undefined}>
      <motion.div
        className="create-menu-surface"
        animate={{ width: open ? 292 : 92, height: open ? 58 : 38, borderRadius: open ? 20 : 19 }}
        transition={LIQUID}
        aria-hidden="true"
      />
      <button
        type="button"
        className="create-menu-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled || busy}
        onClick={press}
      >
        <Plus size={16} strokeWidth={2.2} />
        <span>{busy ? '生成中' : '创建'}</span>
      </button>
      <div className="create-menu-panel" role="menu" aria-label="选择报告生成范围">
        {ITEMS.map(({ scope, label, Icon }, index) => (
          <button
            key={scope}
            type="button"
            role="menuitem"
            className="create-menu-item"
            style={{ transitionDelay: open ? `${30 + index * 22}ms` : '0ms' }}
            tabIndex={open ? 0 : -1}
            onClick={() => {
              setOpen(false);
              onSelect(scope);
            }}
          >
            <Icon size={15} strokeWidth={2} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
