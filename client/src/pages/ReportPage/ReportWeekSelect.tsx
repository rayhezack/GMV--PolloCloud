import { useState } from 'react';
import * as Select from '@radix-ui/react-select';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { formatAnalysisWeekLabel, getReportPeriodKey } from './report-page.utils';

type Week = { periodStart: string; periodEnd: string };

export function ReportWeekSelect({ weeks, value, onValueChange }: { weeks: Week[]; value: string; onValueChange: (value: string) => void }) {
  const selected = Math.max(0, weeks.findIndex(week => getReportPeriodKey(week.periodStart, week.periodEnd) === value));
  const [focused, setFocused] = useState(selected);
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
              return <Select.Item key={key} value={key} className="report-week-option" onFocus={() => setFocused(index)}>
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
