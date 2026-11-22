import DatePicker from '@/components/dashboard/DashboardDatePicker';
import { WeekComparisonPicker } from '@/components/dashboard/WeekComparisonPicker';
import { LOCAL_DATA_WINDOW } from '@/lib/local-data-window';
import { getBusinessWeekStart } from '@shared/business-week';
import { Definition } from './primitives';
import { Popover } from '@astryxdesign/core/Popover';
import { day, shortDay } from '@shared/format';
import { WorkbenchIcon } from '@/components/icons/WorkbenchIcon';
import { shiftDay } from './trend-data';
const noop = () => {};
export default function ComparisonPicker({
  baseline,
  analysis,
  maxDate,
  mode,
  onChange,
  ordered = false,
  compactDay = false,
}: {
  baseline: string;
  analysis: string;
  maxDate: string;
  mode: 'day' | 'week';
  ordered?: boolean;
  compactDay?: boolean;
  onChange: (value: { baseline: string; analysis: string }) => void;
}) {
  if (mode === 'week') {
    const minimum = LOCAL_DATA_WINDOW?.startDate ?? '2026-01-01';
    const weeks: string[] = [];
    for (
      let week = getBusinessWeekStart(minimum);
      week <= getBusinessWeekStart(maxDate || analysis);
      week = shiftDay(week, 7)
    ) {
      if (week >= minimum) weeks.push(week);
    }
    return (
      <div className="v62-comparison" aria-label="业务周比较">
        <WeekComparisonPicker
          availableEnd={maxDate}
          ordered={ordered}
          baselineWeek={baseline}
          analysisWeek={analysis}
          availableWeeks={weeks}
          onWeekChange={(value) =>
            onChange({ baseline: value.baselineWeek ?? baseline, analysis: value.analysisWeek ?? analysis })
          }
        />
        <Definition>业务周从周六至周五。未完整周仅使用两周均有完整数据的相同业务日，比较日均值。</Definition>
      </div>
    );
  }
  const dates = (
    <div className="v62-comparison" aria-label="单日比较">
      <span>分析</span>
      <DatePicker
        date={analysis}
        maxDate={maxDate}
        label="分析日"
        onDateChange={(date) => onChange({ baseline, analysis: date })}
        onValidityChange={noop}
      />
      <span>较</span>
      <DatePicker
        date={baseline}
        maxDate={maxDate}
        label="基准日"
        onDateChange={(date) => onChange({ baseline: date, analysis })}
        onValidityChange={noop}
      />
    </div>
  );
  return compactDay ? (
    <Popover label="单日比较日期" content={dates}>
      <button className="chain-day-picker">
        <WorkbenchIcon name="日历" />
        {day(analysis)} ·{' '}
        {baseline === shiftDay(analysis, -7)
          ? '较上周同日'
          : baseline === shiftDay(analysis, -1)
            ? '较前一日'
            : '较基准日'}{' '}
        {shortDay(baseline)}
      </button>
    </Popover>
  ) : (
    dates
  );
}
