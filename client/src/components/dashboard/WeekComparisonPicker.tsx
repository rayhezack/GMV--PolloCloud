import { useEffect, useId, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CalendarRange, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
const endOfWeek = (date: string) => new Date(Date.parse(date+'T00:00:00Z')+6*86400000).toISOString().slice(0,10);
const formatShortWeekRange = (date: string) => `${date.slice(5).replace('-', '/')} - ${endOfWeek(date).slice(5).replace('-', '/')}`;
const formatWeekRange = (date: string) => `${date} ~ ${endOfWeek(date).slice(5)}`;
export function WeekComparisonPicker({baselineWeek,analysisWeek,availableWeeks,onWeekChange,className='',triggerText}:{baselineWeek:string;analysisWeek:string;availableWeeks:string[];onWeekChange:(value:{baselineWeek?:string;analysisWeek?:string})=>void;className?:string;triggerText?:string}) {
  const [weekOpen,setWeekOpen]=useState(false);
  const [weekPickerMode,setWeekPickerMode]=useState<'baseline'|'analysis'|null>(null);
  const [weekMenuFocused,setWeekMenuFocused]=useState<string|null>(null);
  const reducedMotion=useReducedMotion();
  const highlightId=useId();
  const controlsRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!weekOpen)return;
    const close=()=>{setWeekOpen(false);setWeekPickerMode(null);setWeekMenuFocused(null);};
    const outside=(event:PointerEvent)=>{if(!controlsRef.current?.contains(event.target as Node))close();};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){close();controlsRef.current?.querySelector('button')?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[weekOpen]);
  return (
        <div ref={controlsRef} className={`icon-control-wrap ${className}`} >
          <button type="button" className="icon-control week-control-trigger" aria-expanded={weekOpen} aria-label={`业务周筛选：基准周 ${formatShortWeekRange(baselineWeek)}，分析周 ${formatShortWeekRange(analysisWeek)}`} title="业务周" onClick={() => setWeekOpen((open) => !open)}>
            {triggerText ? <span>{triggerText}</span> : <><CalendarRange size={17} />
            <span className="week-control-summary" aria-hidden="true">
              <span><em>基准</em>{formatShortWeekRange(baselineWeek)}</span>
              <span><em>分析</em>{formatShortWeekRange(analysisWeek)}</span>
            </span>
            </>}
          </button>
          {weekOpen ? (
            <div className="icon-control-popover week-control-popover" aria-label="业务周筛选">
              {weekPickerMode ? (
                <>
                  <div className="week-menu-heading">
                    <button type="button" className="week-menu-back" aria-label="返回业务周选择" onClick={() => { setWeekPickerMode(null); setWeekMenuFocused(null); }}>
                      <ChevronLeft size={15} />
                    </button>
                    <span>{weekPickerMode === 'baseline' ? '选择基准周' : '选择分析周'}</span>
                  </div>
                  <div className="week-menu-options" role="listbox" aria-label={weekPickerMode === 'baseline' ? '基准周选项' : '分析周选项'}>
                    {availableWeeks.slice().reverse().map((week) => {
                      const selected = week === (weekPickerMode === 'baseline' ? baselineWeek : analysisWeek);
                      const disabled = week === (weekPickerMode === 'baseline' ? analysisWeek : baselineWeek);
                      const distance = weekMenuFocused ? Math.min(Math.abs(availableWeeks.indexOf(week) - availableWeeks.indexOf(weekMenuFocused)), 3) : 0;
                      return (
                        <button
                          key={week}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          disabled={disabled}
                          className={cn('week-menu-option', selected && 'is-selected')}
                          style={{ opacity: 1 - distance * 0.08, transform: `scale(${1 - distance * 0.012})` }}
                          onMouseEnter={() => setWeekMenuFocused(week)}
                          onClick={() => {
                            onWeekChange(weekPickerMode === 'baseline' ? { baselineWeek: week } : { analysisWeek: week });
                            setWeekOpen(false);
                            setWeekPickerMode(null);
                            setWeekMenuFocused(null);
                          }}
                        >
                          {weekMenuFocused === week ? <motion.span className="week-menu-highlight" layoutId={highlightId} transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 38 }} /> : null}
                          <span>{formatWeekRange(week)}</span>
                          {selected ? <Check size={16} /> : null}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div className="icon-control-popover-title">业务周</div>
                  <div className="week-menu-fields">
                    <button type="button" className="week-menu-field" onClick={() => { setWeekPickerMode('baseline'); setWeekMenuFocused(baselineWeek); }}>
                      <span>基准周</span>
                      <strong>{formatShortWeekRange(baselineWeek)}</strong>
                      <ChevronRight size={15} />
                    </button>
                    <button type="button" className="week-menu-field" onClick={() => { setWeekPickerMode('analysis'); setWeekMenuFocused(analysisWeek); }}>
                      <span>分析周</span>
                      <strong>{formatShortWeekRange(analysisWeek)}</strong>
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
  );
}
