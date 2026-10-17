import { useCallback, useEffect, useRef, useState } from 'react';
import * as Select from '@radix-ui/react-select';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { formatAnalysisWeekLabel, getReportPeriodKey } from './report-page.utils';

type Week = { periodStart: string; periodEnd: string };

export function ReportWeekSelect({ weeks, value, onValueChange }: { weeks: Week[]; value: string; onValueChange: (value: string) => void }) {
  const selected = Math.max(0, weeks.findIndex(week => getReportPeriodKey(week.periodStart, week.periodEnd) === value));
  const [focused, setFocused] = useState(selected);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const focusedRef = useRef(selected);
  const wheelLockedRef = useRef(false);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setFocused(selected), [selected]);
  useEffect(() => { focusedRef.current = focused; }, [focused]);
  useEffect(() => () => {
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
  }, []);
  const focusIndex = useCallback((index: number) => {
    const next = Math.max(0, Math.min(weeks.length - 1, index));
    setFocused(next);
    requestAnimationFrame(() => {
      itemRefs.current[next]?.scrollIntoView({ block: 'center', behavior: 'auto' });
      itemRefs.current[next]?.focus({ preventScroll: true });
    });
  }, [weeks.length]);
  return (
    <Select.Root value={value} onValueChange={onValueChange} onOpenChange={open => { if (open) focusIndex(selected); }}>
      <Select.Trigger className="report-week-trigger" aria-label="业务周">
        <CalendarDays size={16} /><Select.Value /><Select.Icon><ChevronDown size={16} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="report-week-menu" position="popper" align="start" sideOffset={8} collisionPadding={16}>
          <Select.Viewport
            className="report-week-viewport"
            onWheel={event => {
              if (weeks.length < 2 || Math.abs(event.deltaY) < 4) return;
              event.preventDefault();
              event.stopPropagation();
              if (wheelLockedRef.current) return;
              wheelLockedRef.current = true;
              focusIndex(focusedRef.current + (event.deltaY > 0 ? 1 : -1));
              wheelTimerRef.current = setTimeout(() => {
                wheelLockedRef.current = false;
                wheelTimerRef.current = null;
              }, 260);
            }}
          >
            {weeks.map((week, index) => {
              const key = getReportPeriodKey(week.periodStart, week.periodEnd);
              const distance = Math.min(3, Math.abs(index - focused));
              return <Select.Item key={key} value={key} ref={node => { itemRefs.current[index] = node; }} data-distance={distance} data-focused={focused === index || undefined} className="report-week-option" onFocus={() => setFocused(index)}>
                {focused === index && <span className="report-week-highlight" />}
                <Select.ItemText>{formatAnalysisWeekLabel(week.periodStart, week.periodEnd)}</Select.ItemText>
                <Select.ItemIndicator className="report-week-check"><Check size={16} /></Select.ItemIndicator>
              </Select.Item>;
            })}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
