import { Autocomplete, Button, ListBox, Popover, SearchField } from '@heroui/react';
import { motion, useReducedMotion } from 'framer-motion';
import { useId, useRef, useState } from 'react';
import './picker.css';

export interface PickerProps {
  value: string;
  onChange: (value: string) => void;
  items: readonly { value: string; label: string }[];
  label: string;
  className?: string;
  searchable?: boolean;
}

// Adapted from Bencho Assignees / Picker (MIT, bencho.dev/licence).
// The original unfolds from the pill's corner, not the card's centre.
// Keep the spring's character; HeroUI owns the portal and focus lifecycle.
const unfold = { type: 'spring' as const, stiffness: 460, damping: 23, mass: 0.9 };
const filterItem = (text: string, query: string) =>
  text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

export function Picker({ value, onChange, items, label, className, searchable = false }: PickerProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [portalContainer, setPortalContainer] = useState<Element | undefined>();
  const reducedMotion = useReducedMotion();
  const listId = useId();
  const selected = items.find(item => item.value === value);

  const choose = (next: string) => {
    if (next !== value) onChange(next);
    setOpen(false);
  };

  const options = (
    <ListBox
      id={listId}
      aria-label={label}
      className="bencho-picker-list"
      items={items}
      selectionMode="single"
      selectedKeys={selected ? [value] : []}
      autoFocus={searchable ? undefined : true}
      disallowEmptySelection
      onSelectionChange={keys => {
        if (keys === 'all') return;
        const next = keys.values().next().value;
        if (next !== undefined) choose(String(next));
      }}
      onAction={key => choose(String(key))}
      renderEmptyState={() => <div className="bencho-picker-empty" role="status">暂无匹配选项</div>}
    >
      {item => (
        <ListBox.Item id={item.value} textValue={item.label} data-value={item.value} className="bencho-picker-option">
          <motion.div
            className="bencho-picker-option-content"
            initial={reducedMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reducedMotion ? { duration: 0 } : {
              type: 'spring', stiffness: 620, damping: 34, mass: 0.7,
              // Preserve Bencho's deal-out without making long lists wait.
              delay: 0.03 + Math.min(items.indexOf(item), 5) * 0.04,
            }}
          >
            <span className="bencho-picker-option-label">{item.label}</span>
            <ListBox.ItemIndicator />
          </motion.div>
        </ListBox.Item>
      )}
    </ListBox>
  );

  return (
    <div ref={root} className={['bencho-picker', className].filter(Boolean).join(' ')}>
      <Popover isOpen={open} onOpenChange={next => {
        // Keep nested overlays inside the modal's scroll/focus boundary.
        // A body portal is treated as outside by Radix's scroll lock.
        if (next) setPortalContainer(root.current?.closest('[data-slot="dialog-content"]') ?? undefined);
        setOpen(next);
      }}>
        <Button
          type="button"
          size="sm"
          variant="tertiary"
          className="bencho-picker-trigger"
          aria-label={label}
          aria-controls={open ? listId : undefined}
          data-open={open || undefined}
          isDisabled={!items.length}
        >
          <span className="bencho-picker-value">{selected?.label ?? label}</span>
        </Button>
        <Popover.Content
          className="bencho-picker-popover"
          UNSTABLE_portalContainer={portalContainer}
          placement="bottom end"
          offset={6}
          containerPadding={12}
          shouldFlip={false}
          shouldSkipAnimation={Boolean(reducedMotion)}
        >
          <motion.div
            className="bencho-picker-surface"
            onKeyDownCapture={event => {
              // SearchField normally clears its query on Escape. Here Escape
              // dismisses the entire picker and HeroUI restores trigger focus.
              if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              }
              // Commit either virtual (search) or real list focus without
              // submitting a surrounding form. IME Enter remains composition.
              if (!event.nativeEvent.isComposing && event.target instanceof HTMLElement) {
                const input = event.target instanceof HTMLInputElement;
                const activeId = input ? event.target.getAttribute('aria-activedescendant') : null;
                const option = input
                  ? (activeId ? document.getElementById(activeId) : null)
                  : event.target.closest('.bencho-picker-option');
                const next = event.key === 'Enter' || (!input && event.key === ' ')
                  ? option?.getAttribute('data-value') : null;
                if (next != null) {
                  event.preventDefault();
                  event.stopPropagation();
                  choose(next);
                }
              }
            }}
            initial={reducedMotion ? false : { opacity: 0, y: -10, scaleX: 0.86, scaleY: 0.72 }}
            animate={open
              ? { opacity: 1, y: 0, scaleX: 1, scaleY: 1 }
              : { opacity: 0, y: -8, scaleX: 0.92, scaleY: 0.86 }}
            transition={reducedMotion ? { duration: 0 } : { ...unfold, opacity: { duration: 0.12 } }}
          >
            <Popover.Dialog
              aria-label={label}
              className="bencho-picker-dialog"
            >
              {searchable ? (
                <Autocomplete.Filter filter={filterItem}>
                  <SearchField aria-label={`搜索${label}`} className="bencho-picker-search">
                    <SearchField.Input
                      autoFocus
                      className="bencho-picker-input"
                      placeholder={`搜索${label}`}
                    />
                  </SearchField>
                  {options}
                </Autocomplete.Filter>
              ) : options}
            </Popover.Dialog>
          </motion.div>
        </Popover.Content>
      </Popover>
    </div>
  );
}
