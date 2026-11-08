import { useEffect, useMemo, useState } from 'react';
import { Button, DateField, DateRangePicker, FieldError, RangeCalendar } from '@heroui/react';
import { getLocalTimeZone, parseDate, today, type DateValue } from '@internationalized/date';
import { I18nProvider } from 'react-aria-components';
import { CalendarDays } from 'lucide-react';
import { LOCAL_DATA_WINDOW } from '@/lib/local-data-window';
import './dashboard-date-range-picker.css';

type DateRange = { start: DateValue; end: DateValue };
type SelectedRange = { startDate: string; endDate: string };

type Props = {
  selectedRange: SelectedRange;
  onRangeChange: (range: SelectedRange) => void;
  // Retained for existing callers; local coverage bounds always apply.
  allowLocalSelection?: boolean;
  availableRange?: SelectedRange | null;
};

export default function DashboardDateRangePicker({ selectedRange, onRangeChange, availableRange = LOCAL_DATA_WINDOW }: Props) {
  const minDate = availableRange?.startDate ?? '2026-01-01';
  const maxDate = availableRange?.endDate ?? today(getLocalTimeZone()).subtract({ days: 1 }).toString();
  const minimum = useMemo(() => parseDate(minDate), [minDate]);
  const maximum = useMemo(() => parseDate(maxDate), [maxDate]);
  const selected = useMemo(() => {
    // A stale URL must not put the picker outside the available data window.
    const clamp = (date: string) => parseDate(date < minDate ? minDate : date > maxDate ? maxDate : date);
    const start = clamp(selectedRange.startDate);
    const end = clamp(selectedRange.endDate);
    return start.compare(end) <= 0 ? { start, end } : { start: end, end: start };
  }, [selectedRange.startDate, selectedRange.endDate, minDate, maxDate]);
  const [value, setValue] = useState<DateRange | null>(selected);
  const [open, setOpen] = useState(false);
  useEffect(() => setValue(selected), [selected]);

  const isValid = (range: DateRange) => range.start.compare(minimum) >= 0
    && range.end.compare(maximum) <= 0 && range.start.compare(range.end) <= 0;
  const invalid = value !== null && !isValid(value);
  const commit = (range: DateRange | null) => {
    setValue(range);
    // Incomplete or invalid keyboard edits never reach the dashboard request.
    if (!range || !isValid(range)) return;
    onRangeChange({ startDate: range.start.toString(), endDate: range.end.toString() });
  };
  const chooseQuickRange = (days?: number) => {
    const candidate = days ? maximum.subtract({ days: days - 1 }) : minimum;
    commit({ start: candidate.compare(minimum) < 0 ? minimum : candidate, end: maximum });
    setOpen(false);
  };

  return (
    <I18nProvider locale="zh-CN">
      <DateRangePicker
        className="dashboard-date-picker"
        aria-label="趋势日期"
        granularity="day"
        shouldForceLeadingZeros
        minValue={minimum}
        maxValue={maximum}
        value={value}
        onChange={commit}
        isInvalid={invalid}
        isOpen={open}
        onOpenChange={setOpen}
      >
        <DateField.Group className="dashboard-date-picker__group" onClickCapture={event=>{
          if (!(event.target instanceof Element) || event.target.closest('[data-slot="date-range-picker-trigger"]')) return;
          setOpen(true);
        }}>
          <DateField.Input slot="start" aria-label="开始日期" className="dashboard-date-picker__input">
            {(segment) => <DateField.Segment segment={segment.type === 'literal' ? { ...segment, text: '/' } : segment} />}
          </DateField.Input>
          <DateRangePicker.RangeSeparator>–</DateRangePicker.RangeSeparator>
          <DateField.Input slot="end" aria-label="结束日期" className="dashboard-date-picker__input">
            {(segment) => <DateField.Segment segment={segment.type === 'literal' ? { ...segment, text: '/' } : segment} />}
          </DateField.Input>
          <DateField.Suffix>
            <DateRangePicker.Trigger aria-label="打开日历">
              <DateRangePicker.TriggerIndicator><CalendarDays aria-hidden="true" size={16} /></DateRangePicker.TriggerIndicator>
            </DateRangePicker.Trigger>
          </DateField.Suffix>
        </DateField.Group>
        <FieldError className="dashboard-date-picker__error">
          请选择 {minDate} 至 {maxDate} 内的有效日期范围
        </FieldError>
        <DateRangePicker.Popover
          className="dashboard-date-picker__popover"
          placement="bottom end"
          shouldFlip={false}
          offset={8}
          aria-label="选择趋势日期"
        >
          <RangeCalendar
            aria-label="趋势日期日历"
            minValue={minimum}
            maxValue={maximum}
            className="dashboard-date-picker__calendar"
          >
            <RangeCalendar.Header>
              <RangeCalendar.YearPickerTrigger aria-label="选择年份">
                <RangeCalendar.YearPickerTriggerHeading />
                <RangeCalendar.YearPickerTriggerIndicator />
              </RangeCalendar.YearPickerTrigger>
              <RangeCalendar.NavButton slot="previous" aria-label="上一个月" />
              <RangeCalendar.NavButton slot="next" aria-label="下一个月" />
            </RangeCalendar.Header>
            <RangeCalendar.Grid>
              <RangeCalendar.GridHeader>
                {(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}
              </RangeCalendar.GridHeader>
              <RangeCalendar.GridBody>
                {(date) => <RangeCalendar.Cell date={date} />}
              </RangeCalendar.GridBody>
            </RangeCalendar.Grid>
            <RangeCalendar.YearPickerGrid>
              <RangeCalendar.YearPickerGridBody>
                {({ year }) => <RangeCalendar.YearPickerCell year={year} />}
              </RangeCalendar.YearPickerGridBody>
            </RangeCalendar.YearPickerGrid>
          </RangeCalendar>
          <div className="dashboard-date-picker__quick" aria-label="快捷日期范围">
            <Button size="sm" variant="tertiary" onPress={() => chooseQuickRange(7)}>近一周</Button>
            <Button size="sm" variant="tertiary" onPress={() => chooseQuickRange(30)}>近一个月</Button>
            <Button size="sm" variant="tertiary" onPress={() => chooseQuickRange(90)}>近一个季度</Button>
            <Button size="sm" variant="tertiary" onPress={() => chooseQuickRange()}>清除</Button>
          </div>
        </DateRangePicker.Popover>
      </DateRangePicker>
    </I18nProvider>
  );
}
