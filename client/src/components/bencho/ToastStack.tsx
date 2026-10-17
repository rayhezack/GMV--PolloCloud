import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CircleCheck, CircleX, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import './bencho.css';

export type ToastStackKind = 'success' | 'info' | 'error' | 'warning';
export type ToastStackItem = {
  id: string;
  kind: ToastStackKind;
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
  duration?: number;
};

const ICON: Record<ToastStackKind, LucideIcon> = {
  success: CircleCheck,
  info: Info,
  error: CircleX,
  warning: TriangleAlert,
};

const listeners = new Set<(toast: ToastStackItem) => void>();
const pendingToasts: ToastStackItem[] = [];
let nextToastId = 0;

/** Push a product notification into the global Bencho toast stack. */
export function pushToast(toast: Omit<ToastStackItem, 'id'> & { id?: string }) {
  const item = { ...toast, id: toast.id ?? `toast-${Date.now()}-${nextToastId++}` };
  if (!listeners.size) pendingToasts.push(item);
  listeners.forEach(listener => listener(item));
  return item.id;
}

const W = 300;
const H = 64;
const SHOWN = 3;
const SPRING = { type: 'spring', stiffness: 380, damping: 34, mass: 1 } as const;

/**
 * Three toasts, always: the newest in front, the two before it tucked behind
 * with a sliver showing. Point at the stack and it fans out into a list.
 * The frame is the list's own size, so hovering it is hovering the list.
 */
export function ToastStack({ peek = 14, gap = 10, corner = 20 }: { peek?: number; gap?: number; corner?: number }) {
  const [stack, setStack] = useState<ToastStackItem[]>([]);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const add = (toast: ToastStackItem) => {
      setStack(current => [toast, ...current.filter(item => item.id !== toast.id)].slice(0, SHOWN));
      if (toast.duration && toast.duration > 0) {
        const timer = window.setTimeout(() => dismiss(toast.id), toast.duration);
        timers.current.set(toast.id, timer);
      }
    };
    listeners.add(add);
    pendingToasts.splice(0).forEach(add);
    return () => {
      listeners.delete(add);
      timers.current.forEach(timer => window.clearTimeout(timer));
      timers.current.clear();
    };
  }, []);

  const dismiss = (id: string) => {
    if (leaving !== null) return;
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setLeaving(id);
    window.setTimeout(() => {
      setStack(current => current.filter(item => item.id !== id));
      setLeaving(current => current === id ? null : current);
    }, 220);
  };

  const listH = SHOWN * H + (SHOWN - 1) * gap;
  const stackH = H + (SHOWN - 1) * peek;
  const frameH = listH;
  const place = (index: number) => {
    if (open) return { y: (frameH - listH) / 2 + (SHOWN - 1 - index) * (H + gap), scale: 1 };
    const d = Math.min(index, SHOWN - 1);
    return { y: (frameH - stackH) / 2 + (SHOWN - 1 - d) * peek, scale: 1 - d * 0.05 };
  };

  if (!stack.length) return null;
  return (
    <div
      ref={root}
      className="tst"
      role="region"
      aria-label="通知"
      data-open={open || undefined}
      style={{ width: W, height: frameH, ['--tst-r' as string]: `${corner}px` } as CSSProperties}
      onPointerOver={() => setOpen(true)}
      onPointerOut={event => {
        const related = event.relatedTarget as Node | null;
        if (!related || !root.current?.contains(related)) setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onBlur={event => { if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    >
      {stack.map((toast, index) => {
        const Icon = ICON[toast.kind];
        const position = place(index);
        const front = index === 0;
        const out = leaving === toast.id;
        return (
          <motion.div
            key={toast.id}
            className="tst-toast"
            data-kind={toast.kind}
            data-front={front || undefined}
            style={{ height: H, zIndex: SHOWN - index }}
            initial={{ y: place(0).y + 24, scale: 1, opacity: 0, x: 0 }}
            animate={out ? { y: position.y, scale: position.scale, opacity: 0, x: 60 } : { y: position.y, scale: position.scale, opacity: 1, x: 0 }}
            transition={out ? { duration: 0.22, ease: [0.4, 0, 1, 1] } : SPRING}
            aria-hidden={!open && !front ? true : undefined}
          >
            <span className="tst-icon"><Icon size={18} strokeWidth={2} aria-hidden="true" /></span>
            <span className="tst-text"><b>{toast.title}</b><span>{toast.body}</span></span>
            {toast.action && <button type="button" className="tst-act" tabIndex={open || front ? 0 : -1} onClick={() => toast.onAction?.()}>{toast.action}</button>}
            <button type="button" className="tst-x" aria-label={`关闭 ${toast.title}`} tabIndex={open || front ? 0 : -1} onClick={() => dismiss(toast.id)}><X size={16} strokeWidth={2} aria-hidden="true" /></button>
          </motion.div>
        );
      })}
    </div>
  );
}
