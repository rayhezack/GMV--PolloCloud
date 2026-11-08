import { Button, Popover } from '@heroui/react';
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ChevronDown, CreditCard, RefreshCw } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import './icon-bar.css';

export function IconBar<T extends string>({ items, value, onChange, label, collapsible = false }: {
  items: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  collapsible?: boolean;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const selectedIndex = items.findIndex(item => item.value === value);
  const itemIcon = (itemValue: string) => itemValue === 'renewal' ? <RefreshCw size={14}/> : <CreditCard size={14}/>;

  // Bencho Aspect (MIT, bencho.dev/licence): one moving thumb, with
  // only the selected option in the tab order. Text replaces its icons.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!items.length || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!direction && event.key !== 'Home' && event.key !== 'End') return;
    const focused = event.target instanceof HTMLElement
      ? event.target.closest<HTMLButtonElement>('.chain-icon-bar-button') : null;
    const from = focused ? buttons.current.indexOf(focused) : Math.max(0, selectedIndex);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (Math.max(0, from) + direction + items.length) % items.length;
    event.preventDefault();
    event.stopPropagation();
    buttons.current[next]?.focus();
    if (items[next].value !== value) onChange(items[next].value);
  };

  if (collapsible) {
    return (
      <div className="chain-icon-bar is-collapsible chain-fold-picker">
        <Popover isOpen={open} onOpenChange={setOpen}>
          <Button className="chain-fold-trigger" variant="tertiary" aria-label={label} isDisabled={!items.length}>
            {itemIcon(value)}<span>{items[selectedIndex]?.label ?? label}</span>
            <ChevronDown size={14} className={open ? 'is-open' : undefined}/>
          </Button>
          <Popover.Content placement="bottom end" offset={10} shouldFlip className="chain-fold-popover" shouldSkipAnimation>
            <motion.div className="chain-fold-surface" initial={reducedMotion ? false : {opacity:0,y:-8,scale:.94}} animate={{opacity:1,y:0,scale:1}} transition={{type:'spring',stiffness:520,damping:32,mass:.7}}>
              <Popover.Dialog aria-label={label}>
                <div role="group" aria-label={`${label}选项`} className="chain-fold-options" onKeyDownCapture={onKeyDown}>
                  {items.map((item,index) => <Button key={item.value} ref={node=>{buttons.current[index]=node;}} className="chain-icon-bar-button chain-fold-option" variant="tertiary" aria-pressed={item.value===value} onPress={()=>{if(item.value!==value)onChange(item.value);setOpen(false);}}>{itemIcon(item.value)}<span>{item.label}</span></Button>)}
                </div>
              </Popover.Dialog>
            </motion.div>
          </Popover.Content>
        </Popover>
      </div>
    );
  }

  return (
    <div
      className="chain-icon-bar"
      role="group"
      aria-label={label}
      onKeyDownCapture={onKeyDown}
      style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }}
    >
      {selectedIndex >= 0 && (
        <motion.span
          className="chain-icon-bar-thumb"
          aria-hidden="true"
          initial={false}
          animate={{ x: `${selectedIndex * 100}%` }}
          transition={reducedMotion ? {duration:0} : {type:'spring',stiffness:420,damping:32,mass:.8}}
          style={{
            width: `calc((100% - 4px) / ${items.length})`,
            transition: 'none',
          }}
        />
      )}
      {items.map((item, index) => (
        <Button
          key={item.value}
          ref={element => { buttons.current[index] = element; }}
          type="button"
          size="sm"
          variant="tertiary"
          aria-pressed={value === item.value}
          excludeFromTabOrder={index !== Math.max(0, selectedIndex)}
          className="chain-icon-bar-button"
          onPress={() => { if (value !== item.value) onChange(item.value); }}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
