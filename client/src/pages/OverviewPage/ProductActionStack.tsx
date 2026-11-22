import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { ProductAction } from '@shared/product-actions';
import productActionIcon from '@/assets/icons/product-action.svg';
import './product-action-stack.css';

const STEP = 220;
/** Native scrolling owns the index; the fixed stage only presents the focused card. */
export function ProductActionStack({ actions, date }: { actions: ProductAction[]; date: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [opened, setOpened] = useState(false);
  const wasOpened = useRef(false);
  const reduced = useReducedMotion();
  const visible = actions;
  useEffect(() => {
    setOpened(false);
    setIndex(0);
    viewport.current?.scrollTo({ top: 0 });
  }, [date]);
  useEffect(() => {
    viewport.current?.scrollTo({ top: opened ? index * STEP : 0, behavior: 'instant' });
    if (!opened && wasOpened.current) {
      viewport.current
        ?.querySelectorAll<HTMLButtonElement>('.product-action-list-item')
        [index]?.focus({ preventScroll: true });
    }
    wasOpened.current = opened;
    // Scroll initialization belongs to the mode transition; native scrolling owns subsequent indices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);
  const marker = (
    <span className="product-action-marker" aria-hidden="true">
      <img src={productActionIcon} alt="" />
    </span>
  );
  const go = (next: number) =>
    viewport.current?.scrollTo({
      top: Math.max(0, Math.min(visible.length - 1, next)) * STEP,
      behavior: reduced ? 'instant' : 'smooth',
    });
  return (
    <div className="product-action-stack">
      <div
        ref={viewport}
        className="product-action-viewport"
        data-mode={opened ? 'cards' : 'list'}
        role="region"
        aria-label="产品动作卡片"
        tabIndex={0}
        onScroll={(event) =>
          opened && setIndex(Math.min(visible.length - 1, Math.round(event.currentTarget.scrollTop / STEP)))
        }
        onKeyDown={(event) => {
          if (!opened || event.target !== event.currentTarget) return;
          const next =
            event.key === 'ArrowDown'
              ? index + 1
              : event.key === 'ArrowUp'
                ? index - 1
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? visible.length - 1
                    : null;
          if (next == null) return;
          event.preventDefault();
          go(next);
        }}
      >
        {!opened ? (
          <div className="product-action-list">
            {visible.map((action, i) => (
              <button
                key={action.id}
                type="button"
                className="product-action-list-item"
                aria-expanded={false}
                onClick={() => {
                  setIndex(i);
                  setOpened(true);
                }}
              >
                {marker}
                <span>
                  <strong>{action.title}</strong>
                  <small>
                    {action.platform}
                    {action.version ? ` · ${action.version}` : ''}
                  </small>
                </span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="product-action-stage">
              {visible.map((action, i) => {
                const offset = i - index,
                  active = offset === 0;
                return (
                  <motion.article
                    key={action.id}
                    className="product-action-card"
                    data-active={active}
                    inert={Math.abs(offset) > 1 ? true : undefined}
                    initial={false}
                    animate={{
                      y: active ? 56 : offset < 0 ? (offset + 1) * 52 : 274 + (offset - 1) * 52,
                      scale: active ? 1 : 0.94,
                      opacity: Math.abs(offset) > 1 ? 0 : 1,
                      height: active ? 206 : 46,
                    }}
                    transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 310, damping: 31 }}
                  >
                    <button
                      type="button"
                      aria-expanded={active}
                      aria-controls={`action-content-${action.id}`}
                      onClick={() => (active ? setOpened(false) : go(i))}
                      tabIndex={Math.abs(offset) > 1 ? -1 : 0}
                    >
                      {marker}
                      <span>{action.title}</span>
                      <ChevronDown size={14} aria-hidden="true" />
                    </button>
                    <div id={`action-content-${action.id}`} className="product-action-content" hidden={!active}>
                      <small>
                        {action.platform}
                        {action.version ? ` · ${action.version}` : ''}
                      </small>
                      <p tabIndex={active ? 0 : -1}>{action.description || '暂无补充说明'}</p>
                    </div>
                  </motion.article>
                );
              })}
            </div>
            <div aria-hidden="true" style={{ height: Math.max(0, visible.length - 1) * STEP }} />
          </>
        )}
      </div>
      <div className="product-action-footer">
        <span>{opened ? `${index + 1} / ${visible.length}` : `${visible.length} 条`}</span>
      </div>
    </div>
  );
}
