import { useState } from 'react';
import * as Select from '@radix-ui/react-select';
import { motion, useReducedMotion } from 'framer-motion';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { formatAnalysisWeekLabel, getReportPeriodKey } from './report-page.utils';

type Week = { periodStart: string; periodEnd: string };

export function ReportWeekSelect({ weeks, value, onValueChange }: { weeks: Week[]; value: string; onValueChange: (value: string) => void }) {
  const selected = Math.max(0, weeks.findIndex(week => getReportPeriodKey(week.periodStart, week.periodEnd) === value));
  const [focused, setFocused] = useState(selected);
  const reducedMotion = useReducedMotion();
  return (
    <Select.Root value={value} onValueChange={onValueChange} onOpenChange={open => { if (open) setFocused(selected); }}>
      <Select.Trigger className="report-week-trigger" aria-label="业务周">
        <CalendarDays size={16} /><Select.Value /><Select.Icon><ChevronDown size={16} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="report-week-menu" position="popper" align="start" sideOffset={8} collisionPadding={16}>
          <Select.Viewport className="report-week-viewport">
            {weeks.map((week, index) => {
              const key = getReportPeriodKey(week.periodStart, week.periodEnd);
              const distance = Math.min(Math.abs(index - focused), 3);
              return <Select.Item key={key} value={key} className="report-week-option" onFocus={() => setFocused(index)} onPointerMove={() => setFocused(index)} style={{ opacity: 1 - distance * 0.1, transform: `scale(${1 - distance * 0.018})` }}>
                {focused === index && <motion.span className="report-week-highlight" layoutId="report-week-highlight" transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 38 }} />}
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
