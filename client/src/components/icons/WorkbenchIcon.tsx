import { useEffect, useRef } from 'react';
import { mountWorkbenchIcon } from './kubai-runtime';
import './workbench-icon.css';

export type WorkbenchIconName = 'chart-line' | 'credit-card' | 'link' | 'paintbrush' |
  'megaphone' | 'file-chart' | 'database' | 'shield-check';

export function WorkbenchIcon({ name, active = false }: {
  name: WorkbenchIconName;
  active?: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const controller = useRef<ReturnType<typeof mountWorkbenchIcon> | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const icon = mountWorkbenchIcon(name, host.current);
    controller.current = icon;
    const parent = host.current.closest('a, button');
    let hovered = false;
    let focused = false;
    const update = () => icon.setHover(hovered || focused);
    const enter = (event: Event) => {
      if ((event as PointerEvent).pointerType === 'touch') return;
      hovered = true;
      update();
    };
    const leave = () => { hovered = false; update(); };
    const focus = () => { focused = Boolean(parent?.matches(':focus-visible')); update(); };
    const blur = () => { focused = false; update(); };
    parent?.addEventListener('pointerenter', enter);
    parent?.addEventListener('pointerleave', leave);
    parent?.addEventListener('focus', focus);
    parent?.addEventListener('blur', blur);
    return () => {
      parent?.removeEventListener('pointerenter', enter);
      parent?.removeEventListener('pointerleave', leave);
      parent?.removeEventListener('focus', focus);
      parent?.removeEventListener('blur', blur);
      icon.destroy();
      controller.current = null;
    };
  }, [name]);
  useEffect(() => { controller.current?.setActive(active); }, [active, name]);
  return <span ref={host} className="workbench-icon" data-icon={name} aria-hidden="true" />;
}
