import { useRef, useState, type CSSProperties } from 'react';
import type { ProductAction } from '@shared/product-actions';
import { signedMoney } from '@shared/format';
import type { GmvAnomalyMetric, OverviewTrendPoint } from '@shared/api.interface';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { calendarColor, calendarDates } from '@shared/calendar-display';
import { day, money, changePct, range } from '@shared/format';
import { PanelHeader } from '../system';
import { Segment } from './primitives';
import { shiftDay } from './trend-data';

type Props = {
  rows: OverviewTrendPoint[];
  metric: GmvAnomalyMetric;
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
  metric,
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
  const [mode, setMode] = useState<'amount' | 'change'>('amount');
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const { dates: cells, rows: weekRows, truncated } = calendarDates(start, end, latest);
  const values = new Map(rows.map((row) => [row.period, row[metric]]));
  const dates = cells.filter((d): d is string => d != null && values.has(d));
  const amounts = dates.map((d) => values.get(d)!).filter(Number.isFinite),
    min = Math.min(...amounts),
    max = Math.max(...amounts);
  const current = dates.includes(selected) ? selected : dates.at(-1);
  return (
    <section
      className="gmv-calendar gmv-heatmap"
      aria-label="GMV 日历"
      style={{ '--gmv-weeks': Math.max(1, weekRows) } as CSSProperties}
    >
      <PanelHeader
        title={{ totalGmv: 'GMV 日历', activeGmv: '主动付费日历', renewalGmv: '自动续订日历' }[metric]}
        unit={range(start, [end, latest || end].sort()[0])}
        inlineUnit
        info="一格代表一天，每列为自然周，每行为周一至周日，范围外和缺失日期留空。金额按色阶呈现，较上周同日按±5%、±10%、±20%分档。红圈表示异动；悬浮或键盘聚焦查看当日数据与产品动作。同期动作不代表变化原因。方向键选日。"
        tools={
          <Segment<'amount' | 'change'>
            label="日历着色"
            value={mode}
            onChange={setMode}
            items={[
              { value: 'amount', label: '金额' },
              { value: 'change', label: '较上周同日' },
            ]}
          />
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
            if (!date)
              return (
                <span
                  key={`blank-${i}`}
                  className="gmv-calendar-blank"
                  style={{ gridColumn: Math.floor(i / 7) + 1, gridRow: (i % 7) + 1 }}
                  aria-hidden="true"
                />
              );
            const value = values.get(date),
              before = values.get(shiftDay(date, -7));
            if (value == null || !Number.isFinite(value))
              return (
                <span
                  key={date}
                  className="gmv-calendar-blank"
                  style={{ gridColumn: Math.floor(i / 7) + 1, gridRow: (i % 7) + 1 }}
                  aria-hidden="true"
                />
              );
            const change = before != null && before !== 0 ? value / before - 1 : null,
              count = actionCounts?.get(date) ?? (actions.has(date) ? 1 : 0);
            const description = `${day(date)} · ${money(value)} · 较上周同日 ${changePct(change)}${anomalies.has(date) ? ' · 异动' : ''}${count ? ` · 产品动作 ${count} 条` : ''}`;
            const metricLabel = { totalGmv: '大盘 GMV', activeGmv: '主动付费', renewalGmv: '自动续订' }[metric];
            const detail = (
              <div className="gmv-day-preview">
                <header>
                  <strong>{day(date)}</strong>
                  {anomalies.has(date) && <span className="gmv-preview-anomaly">异动</span>}
                </header>
                <div>
                  <span>{metricLabel}</span>
                  <b>{money(value)}</b>
                </div>
                <div>
                  <span>上周同日</span>
                  <b>{money(before)}</b>
                </div>
                <div data-direction={change == null ? 'neutral' : change < 0 ? 'negative' : 'positive'}>
                  <span>{before == null ? '—' : signedMoney(value - before)}</span>
                  <b>{changePct(change)}</b>
                </div>
                <footer>
                  {actionsStatus === 'ready'
                    ? `产品动作 ${count} 条 · 点击查看`
                    : actionsStatus === 'loading'
                      ? '正在读取产品动作'
                      : '产品动作暂不可用'}
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
              >
                <button
                  ref={(el) => {
                    if (el) refs.current.set(date, el);
                    else refs.current.delete(date);
                  }}
                  style={
                    {
                      '--cell-color': calendarColor(value, [min, max], change, mode),
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
          {mode === 'amount' ? '低' : '下降'}
          {(mode === 'amount'
            ? ['seq-1', 'seq-2', 'seq-3', 'seq-4', 'seq-5']
            : ['div-neg-3', 'div-neg-2', 'div-0', 'div-pos-2', 'div-pos-3']
          ).map((token) => (
            <i key={token} style={{ background: `var(--${token})` }} />
          ))}
          {mode === 'amount' ? '高' : '上升'}
        </span>
        <span>
          <i className="gmv-anomaly-ring" />
          异动
        </span>
      </footer>
    </section>
  );
}
