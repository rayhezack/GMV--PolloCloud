import { useRef, useState, type CSSProperties } from 'react';
import type { ProductAction } from '@shared/product-actions';
import { metricDifference, count } from '@shared/format';
import type { OverviewTrendPoint } from '@shared/api.interface';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { calendarColor, calendarDates, calendarPeak } from '@shared/calendar-display';
import { day, money, changePct, range } from '@shared/format';
import { PanelHeader } from '../system';
import { WorkbenchIcon } from '../icons/WorkbenchIcon';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '../ui/dropdown-menu';
import { shiftDay } from './trend-data';

type Props = {
  rows: OverviewTrendPoint[];
  selected: string;
  onSelect: (date: string) => void;
  actions: Set<string>;
  actionCounts?: Map<string, number>;
  anomalies: Set<string>;
  start: string;
  end: string;
  latest?: string;
  productActions?: ProductAction[];
  actionsStatus?: 'loading' | 'ready' | 'unavailable';
};
export default function GmvCalendar({
  rows,
  selected,
  onSelect,
  actions,
  actionCounts,
  anomalies,
  start,
  end,
  latest,
  actionsStatus = 'ready',
}: Props) {
  const [measure, setMeasure] = useState<'gmv' | 'orders'>('gmv');
  const [dismissedPreview, setDismissedPreview] = useState<string | null>(null);
  const metricLabel = measure === 'orders' ? '订单量' : '大盘 GMV';
  const formatValue = measure === 'orders' ? count : money;
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const { dates: cells, rows: weekRows, truncated } = calendarDates(start, end, latest);
  const values = new Map(rows.map((row) => [row.period, measure === 'orders' ? row.totalOrders : row.totalGmv]));
  const dates = cells.filter((d): d is string => d != null && values.get(d) != null && Number.isFinite(values.get(d)));
  const amounts = dates.map((d) => values.get(d)!).filter(Number.isFinite),
    min = Math.min(...amounts),
    max = Math.max(...amounts);
  const peak = calendarPeak(values, dates);
  const peakWeekday = peak
    ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(peak.date + 'T00:00:00Z').getUTCDay()]
    : '';
  const current = dates.includes(selected) ? selected : dates.at(-1);
  return (
    <section
      className="gmv-calendar gmv-heatmap"
      aria-label={measure === 'orders' ? '订单量日历' : 'GMV 日历'}
      style={{ '--gmv-weeks': Math.max(1, weekRows) } as CSSProperties}
    >
      <PanelHeader
        title={measure === 'orders' ? '订单量日历' : 'GMV 日历'}
        unit={range(start, [end, latest || end].sort()[0])}
        inlineUnit
        info="一格代表一个有数据的日期，每列为自然周，每行为周一至周日，不展示未来日期的占位格。按所选指标每日数值着色，历史缺失日期留空、不补零。红圈表示异动；悬浮或键盘聚焦查看当日数据与产品动作。同期动作不代表变化原因。方向键选日。"
        tools={
          <div className="gmv-calendar-tools">
            {peak && (
              <button
                type="button"
                className="gmv-calendar-peak"
                onClick={() => onSelect(peak.date)}
                aria-label={`最高${metricLabel}：${day(peak.date)}，${formatValue(peak.value)}`}
              >
                <WorkbenchIcon name="star" active />
                <span>
                  最高：{peakWeekday} {peak.date.slice(5).replace('-', '/')}
                </span>
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="gmv-calendar-measure" aria-label={`日历指标：${metricLabel}`}>
                  <WorkbenchIcon name={measure === 'orders' ? 'receipt' : 'layers'} />
                  {metricLabel}
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="gmv-calendar-menu">
                <DropdownMenuRadioGroup
                  value={measure}
                  onValueChange={(value) => setMeasure(value as 'gmv' | 'orders')}
                >
                  <DropdownMenuRadioItem showIndicator={false} value="gmv">
                    <WorkbenchIcon name="layers" />
                    大盘 GMV
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem showIndicator={false} value="orders">
                    <WorkbenchIcon name="receipt" />
                    订单量
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      {truncated && <span className="sys-meta">更早</span>}
      <div className="gmv-heatmap-body">
        <div className="gmv-heatmap-weekdays">
          {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="gmv-calendar-grid">
          {cells.map((date, i) => {
            if (!date) return null;
            const value = values.get(date),
              before = values.get(shiftDay(date, -7));
            if (value == null || !Number.isFinite(value)) return null;
            const change = before != null && before !== 0 ? value / before - 1 : null,
              count = actionCounts?.get(date) ?? (actions.has(date) ? 1 : 0);
            const description = `${day(date)} · ${formatValue(value)} · 较上周同日 ${changePct(change)}${anomalies.has(date) ? ' · 异动' : ''}${count ? ` · 产品动作 ${count} 条` : ''}`;
            const detail = (
              <div className="gmv-day-preview">
                <header>
                  <strong>{day(date)}</strong>
                  {anomalies.has(date) && <span className="gmv-preview-anomaly">异动</span>}
                </header>
                <div>
                  <span>{metricLabel}</span>
                  <b>{formatValue(value)}</b>
                </div>
                <div>
                  <span>上周同日</span>
                  <b>{formatValue(before)}</b>
                </div>
                <div data-direction={change == null ? 'neutral' : change < 0 ? 'negative' : 'positive'}>
                  <span>
                    {before == null
                      ? '—'
                      : metricDifference(before, value, measure === 'orders' ? 'count' : 'currency')}
                  </span>
                  <b>{changePct(change)}</b>
                </div>
                <footer>
                  {actionsStatus === 'ready' ? (
                    <button
                      type="button"
                      className="gmv-preview-actions"
                      aria-label={`查看 ${date} 的产品动作（${count} 条）`}
                      onClick={() => {
                        setDismissedPreview(date);
                        onSelect(date);
                      }}
                    >
                      产品动作 {count} 条 · 点击查看
                    </button>
                  ) : actionsStatus === 'loading' ? '正在读取产品动作' : '产品动作暂不可用'}
                </footer>
              </div>
            );
            return (
              <Tooltip
                key={date}
                content={detail}
                hasHoverIndication={false}
                focusTrigger="always"
                placement="above"
                hideDelay={120}
                isOpen={dismissedPreview === date ? false : undefined}
              >
                <button
                  ref={(el) => {
                    if (el) refs.current.set(date, el);
                    else refs.current.delete(date);
                  }}
                  style={
                    {
                      '--cell-color': calendarColor(value, [min, max], change, 'amount'),
                      gridColumn: Math.floor(i / 7) + 1,
                      gridRow: (i % 7) + 1,
                    } as CSSProperties
                  }
                  type="button"
                  data-date={date}
                  data-selected={date === selected}
                  data-anomaly={anomalies.has(date)}
                  aria-pressed={date === selected}
                  aria-label={description}
                  tabIndex={date === current ? 0 : -1}
                  onClick={() => onSelect(date)}
                  onPointerEnter={() => setDismissedPreview(null)}
                  onFocus={() => setDismissedPreview(null)}
                  onKeyDown={(event) => {
                    const steps: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
                    if (!(event.key in steps) && !['Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    let target =
                      event.key === 'Home'
                        ? dates[0]
                        : event.key === 'End'
                          ? dates.at(-1)!
                          : shiftDay(date, steps[event.key]);
                    if (!dates.includes(target)) return;
                    refs.current.get(target)?.focus();
                    onSelect(target);
                  }}
                >
                  {anomalies.has(date) && <span className="gmv-anomaly-ring" aria-hidden="true" />}
                </button>
              </Tooltip>
            );
          })}
        </div>
        <div className="gmv-heatmap-weeks">
          {Array.from({ length: weekRows }, (_, i) => (
            <span key={i}>
              {cells
                .slice(i * 7, i * 7 + 7)
                .find(Boolean)
                ?.slice(5)
                .replace('-', '/')}
            </span>
          ))}
        </div>
      </div>
      <footer>
        <span className="gmv-heatmap-scale">
          低
          {['seq-1', 'seq-2', 'seq-3', 'seq-4', 'seq-5'].map((token) => (
            <i key={token} style={{ background: `var(--${token})` }} />
          ))}
          高
        </span>
        <span>
          <i className="gmv-anomaly-ring" />
          异动
        </span>
      </footer>
    </section>
  );
}
