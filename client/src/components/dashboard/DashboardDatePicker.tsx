import { useEffect, useMemo, useState } from 'react';
import { Calendar, DateField, DatePicker, FieldError } from '@heroui/react';
import { parseDate, type DateValue } from '@internationalized/date';
import { I18nProvider } from 'react-aria-components';
import './dashboard-date-range-picker.css';

export default function DashboardDatePicker({ date, onDateChange, onValidityChange, maxDate, isDisabled }: {
  date: string;
  maxDate: string;
  isDisabled?: boolean;
  onDateChange: (date: string) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const minimum = useMemo(() => parseDate('2000-01-01'), []);
  const maximum = useMemo(() => parseDate(maxDate), [maxDate]);
  const selected = useMemo(() => parseDate(date), [date]);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<DateValue | null>(selected);
  useEffect(() => setValue(selected), [selected]);
  const valid = value !== null && value.compare(minimum) >= 0 && value.compare(maximum) <= 0;
  useEffect(() => onValidityChange(valid), [valid, onValidityChange]);

  return (
    <I18nProvider locale="zh-CN">
      <DatePicker className="dashboard-date-picker dashboard-single-date-picker" aria-label="回刷日期"
        granularity="day" shouldForceLeadingZeros isDisabled={isDisabled} isOpen={open} onOpenChange={setOpen}
        minValue={minimum} maxValue={maximum} value={value} isInvalid={!valid}
        onChange={next => {
          setValue(next);
          if (next && next.compare(minimum) >= 0 && next.compare(maximum) <= 0) {
            onDateChange(next.toString());
            setOpen(false);
          }
        }}>
        <DateField.Group className="dashboard-date-picker__group">
          <DateField.Input className="dashboard-date-picker__input">
            {segment => <DateField.Segment segment={segment.type === 'literal' ? { ...segment, text: '/' } : segment} />}
          </DateField.Input>
          <DateField.Suffix>
            <DatePicker.Trigger aria-label="打开回刷日历"><DatePicker.TriggerIndicator /></DatePicker.Trigger>
          </DateField.Suffix>
        </DateField.Group>
        <FieldError className="dashboard-date-picker__error">请选择 {maxDate} 及之前的有效日期</FieldError>
        <DatePicker.Popover className="dashboard-date-picker__popover dashboard-single-date-popover" placement="bottom start" offset={8}>
          <Calendar aria-label="回刷日期日历" minValue={minimum} maxValue={maximum} className="dashboard-date-picker__calendar">
            <Calendar.Header>
              <Calendar.YearPickerTrigger aria-label="选择年份">
                <Calendar.YearPickerTriggerHeading /><Calendar.YearPickerTriggerIndicator />
              </Calendar.YearPickerTrigger>
              <Calendar.NavButton slot="previous" aria-label="上一个月" />
              <Calendar.NavButton slot="next" aria-label="下一个月" />
            </Calendar.Header>
            <Calendar.Grid>
              <Calendar.GridHeader>{day => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
              <Calendar.GridBody>{day => <Calendar.Cell date={day} />}</Calendar.GridBody>
            </Calendar.Grid>
            <Calendar.YearPickerGrid>
              <Calendar.YearPickerGridBody>{({ year }) => <Calendar.YearPickerCell year={year} />}</Calendar.YearPickerGridBody>
            </Calendar.YearPickerGrid>
          </Calendar>
        </DatePicker.Popover>
      </DatePicker>
    </I18nProvider>
  );
}
