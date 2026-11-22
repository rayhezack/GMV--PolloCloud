import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal, ArrowDownToLine } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Modal, PanelHeader, DataTable } from '../system';
import { WorkbenchIcon } from '@/components/icons/WorkbenchIcon';
import { CashFlowAreaChart } from '@/components/cash-flow-area-chart';
import { chartTicks, businessTickIndices, weekendIndices, axisValue } from '../charts/geometry';
import { WeekendBand } from '../charts/Annotations';
import { ChartTooltip } from '../charts/ChartTooltip';
import { PanelState } from '../system/PanelState';
import { Segment, exportCsv, usd, signedUsd } from './primitives';
import { cashFlowSeries, type TrendBucket } from './trend-data';

export default function RevenueTrend({
  title,
  buckets,
  selectedDay,
  onSelect,
  granularity,
  onGranularityChange,
  anomalyDates = [],
  loading = false,
  unit = 'currency',
  changes = true,
  compact = false,
  plotHeight,
  cashFlow = false,
  comparisonPeriods,
  baselineDate,
  headerTools,
}: {
  title: string;
  buckets: TrendBucket[];
  selectedDay: string;
  onSelect: (date: string) => void;
  granularity: 'day' | 'week' | 'month';
  onGranularityChange: (value: 'day' | 'week' | 'month') => void;
  onFullRange?: () => void;
  unit?: 'currency' | 'count' | 'rate';
  changes?: boolean;
  compact?: boolean;
  plotHeight?: number;
  cashFlow?: boolean;
  anomalyDates?: string[];
  loading?: boolean;
  comparisonPeriods?: { baseline: [string, string]; analysis: [string, string] };
  baselineDate?: string;
  headerTools?: ReactNode;
}) {
  const reference = granularity === 'day';
  const host = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(760);
  const [hover, setHover] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [details, setDetails] = useState(false);
  const id = useId().replace(/:/g, '');
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width)));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const selected = buckets.findIndex((bucket) => bucket.dates.includes(selectedDay));
  const index = hover ?? (selected < 0 ? buckets.length - 1 : selected);
  const current = buckets[index];
  const summaryIndex = selected < 0 ? buckets.length - 1 : selected;
  const summary = buckets[summaryIndex];
  const cashSeries = cashFlowSeries(buckets);
  const ticks = chartTicks(buckets.flatMap((b) => [b.value, reference ? b.baseline : null]));
  const min = ticks[0],
    max = ticks.at(-1)!;
  const tickStep = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
  const height = compact ? 210 : 300;
  const top = compact ? 14 : 24,
    bottom = height - (reference && changes ? 90 : 40),
    left = 52,
    right = width - 16;
  const barBaseline = height - 40,
    barHeight = 32;
  const barMax = Math.max(
    1,
    ...buckets.map((bucket) =>
      bucket.baseline == null || !Number.isFinite(bucket.value) ? 0 : Math.abs(bucket.value - bucket.baseline),
    ),
  );
  const barY = (value: number) => barBaseline - (value / barMax) * barHeight;
  const x = (i: number) =>
    buckets.length < 2 ? (left + right) / 2 : left + (i / (buckets.length - 1)) * (right - left);
  const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top);
  const path = (baseline = false) => {
    let connected = false;
    return buckets
      .map((bucket, i) => {
        const value = baseline ? bucket.baseline : bucket.value;
        if (value == null || !Number.isFinite(value)) {
          connected = false;
          return '';
        }
        const segment = `${connected ? 'L' : 'M'}${x(i)},${y(value)}`;
        connected = true;
        return segment;
      })
      .join(' ');
  };
  const tickIndices = businessTickIndices(
    buckets.map((b) => b.date),
    reference,
  ).filter(
    (i, _, all) => i === 0 || i === buckets.length - 1 || (x(i) - x(0) > 48 && x(buckets.length - 1) - x(i) > 48),
  );
  const baselineIndex = baselineDate ? buckets.findIndex((b) => b.dates.includes(baselineDate)) : -1;
  const label = (date: string) =>
    granularity === 'month' ? `${Number(date.slice(5, 7))}月` : date.slice(5).replace('-', '/');
  const showValue = (value: number | null) =>
    value == null || !Number.isFinite(value)
      ? '—'
      : unit === 'currency'
        ? usd(value)
        : unit === 'rate'
          ? `${(value * 100).toFixed(2)}%`
          : Math.round(value).toLocaleString('en-US');
  const showChange = (value: number) =>
    unit === 'currency'
      ? signedUsd(value)
      : unit === 'rate'
        ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)} pp`
        : `${value >= 0 ? '+' : ''}${Math.round(value).toLocaleString('en-US')}`;
  const unitLabel = unit === 'currency' ? 'USD' : unit === 'rate' ? '%' : '人';
  const exportRows = () =>
    exportCsv(`Pollo-${title}-${granularity}.csv`, [
      ['日期', title, '上周同日', '变化'],
      ...buckets.map((bucket) => [
        bucket.date,
        bucket.value,
        bucket.baseline,
        bucket.baseline == null ? null : bucket.value - bucket.baseline,
      ]),
    ]);
  return (
    <section className="v62-trend-panel" aria-label={`${title}趋势`}>
      <PanelHeader
        title={title}
        unit={`${granularity === 'day' ? '日值' : '日均'} · ${unitLabel}`}
        info={
          cashFlow
            ? '紫色面积线为所选指标，灰色虚线为上周同日。悬浮提示展示对应日期；KPI 只跟随选中日。周、月显示日均单线，缺失同期不补零、不插值，纵轴按实际范围缩放。'
            : '实线为所选指标，灰色虚线为上周同日。周、月沿用线上日均口径。纵轴按实际范围缩放。'
        }
        tools={
          <div className="v62-panel-tools">
            {headerTools}
            <Segment
              label="趋势粒度"
              value={granularity}
              onChange={onGranularityChange}
              items={[
                { value: 'day', label: '日' },
                { value: 'week', label: '周' },
                { value: 'month', label: '月' },
              ]}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button ref={moreButton} className="v62-icon-button" aria-label="趋势更多操作">
                  <MoreHorizontal size={18} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="v62-menu" align="end">
                <DropdownMenuItem onSelect={() => setDetails(true)}>
                  <WorkbenchIcon name="database" />
                  数据明细
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={exportRows}>
                  <ArrowDownToLine size={16} aria-hidden="true" />
                  导出趋势 CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      <div className="v62-chart-legend">
        <span>
          <i className="v62-line-key" />
          {reference ? '当日' : '日均'}
        </span>
        {reference && (
          <span>
            <i className="v62-line-key baseline" />
            上周同日
          </span>
        )}
        {reference && changes && !cashFlow && (
          <span>
            <i className="v62-bar-key" />
            变化
          </span>
        )}
      </div>
      {loading ? (
        <PanelState state="loading" />
      ) : !buckets.some((b) => Number.isFinite(b.value)) ? (
        <PanelState state="empty" reason="该日期无数据或快照未覆盖" />
      ) : cashFlow ? (
        summary ? (
          <CashFlowAreaChart
            plotHeight={plotHeight}
            key={`${title}:${granularity}:${buckets.map((bucket) => bucket.date).join(',')}`}
            className={`v62-home-cash-flow${reference ? '' : ' is-single-series'}`}
            title={`${title}趋势图`}
            description=""
            showSummary={false}
            icon={null}
            data={cashSeries.data}
            compare={reference ? cashSeries.compare : []}
            compareIndices={reference ? cashSeries.compareIndices : []}
            daily={reference}
            anomalyDates={anomalyDates}
            partialLabels={Object.fromEntries(buckets.flatMap((b, i) => (b.partial ? [[i, b.partial]] : [])))}
            compareLabel="上周同日"
            totalLabel={`${label(summary.selectedDate)} · ${reference ? '当日值' : '日均'}`}
            total={summary.value}
            changeLabel="上周同日"
            referenceValue={reference ? summary.baseline : null}
            ticks={ticks}
            index={summaryIndex}
            onIndexChange={(next) => onSelect(buckets[next].selectedDate)}
            formatValue={usd}
            formatDate={(date, context) => (context === 'axis' ? label(date) : date)}
            locale="zh-CN"
          />
        ) : (
          <div className="v62-state" role="status">
            {loading ? '正在读取趋势' : '暂无趋势数据'}
          </div>
        )
      ) : (
        <div
          ref={host}
          className="v62-chart"
          tabIndex={0}
          role="group"
          aria-label={`${title}趋势图。左右方向键切换日期，Home 和 End 跳转首尾。`}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onMouseLeave={() => setHover(null)}
          onKeyDown={(event) => {
            if (!buckets.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
            event.preventDefault();
            setHover(null);
            if (event.key === 'Escape') {
              setFocused(false);
              return;
            }
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buckets.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        buckets.length - 1,
                        (selected < 0 ? buckets.length - 1 : selected) + (event.key === 'ArrowLeft' ? -1 : 1),
                      ),
                    );
            onSelect(buckets[next].selectedDate);
          }}
        >
          <svg
            width="100%"
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden="true"
            onPointerMove={(event) => {
              if (!buckets.length) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const point = ((event.clientX - rect.left) * width) / rect.width;
              setHover(
                Math.max(
                  0,
                  Math.min(buckets.length - 1, Math.round(((point - left) / (right - left)) * (buckets.length - 1))),
                ),
              );
            }}
            onClick={() => current && onSelect(current.selectedDate)}
          >
            <defs>
              <pattern
                id={`stripe-${id}`}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(28)"
              >
                <path d="M0 0V6" className="v62-stripe" />
              </pattern>
            </defs>
            {reference &&
              weekendIndices(buckets.map((b) => b.date)).map((i) => (
                <WeekendBand
                  key={`weekend-${i}`}
                  x={Math.max(left, x(i) - (right - left) / Math.max(1, buckets.length - 1) / 2)}
                  width={Math.min(
                    (right - left) / Math.max(1, buckets.length - 1),
                    right - Math.max(left, x(i) - (right - left) / Math.max(1, buckets.length - 1) / 2),
                  )}
                  y={top}
                  height={bottom - top}
                />
              ))}
            {comparisonPeriods &&
              (['baseline', 'analysis'] as const).map((kind) => {
                const [from, to] = comparisonPeriods[kind];
                const inside = buckets.flatMap((b, i) => (b.dates.some((d) => d >= from && d <= to) ? [i] : []));
                if (!inside.length) return null;
                const half = (right - left) / Math.max(1, buckets.length - 1) / 2;
                const a = Math.max(left, x(inside[0]) - half),
                  b = Math.min(right, x(inside.at(-1)!) + half);
                return (
                  <g key={kind} data-period-band={kind}>
                    <rect
                      x={a}
                      y={top}
                      width={b - a}
                      height={bottom - top}
                      fill={kind === 'analysis' ? 'var(--accent-soft)' : 'var(--surface-sunken)'}
                    />
                    <text x={(a + b) / 2} y={top - 8} textAnchor="middle" className="v62-axis-text">
                      {kind === 'analysis' ? '分析周' : '基准周'}
                    </text>
                  </g>
                );
              })}
            {baselineIndex >= 0 && Number.isFinite(buckets[baselineIndex].value) && (
              <g data-baseline-date={baselineDate}>
                <circle
                  cx={x(baselineIndex)}
                  cy={y(buckets[baselineIndex].value)}
                  r={5}
                  fill="var(--surface)"
                  stroke="var(--baseline)"
                  strokeWidth={2}
                />
                <text x={x(baselineIndex)} y={top - 8} className="v62-axis-text" textAnchor="middle">
                  基准日
                </text>
              </g>
            )}
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="v62-grid-line" />
                <text x={left - 12} y={y(tick) + 4} textAnchor="end" className="v62-axis-text">
                  {axisValue(tick, unit)}
                </text>
              </g>
            ))}
            {reference && changes && (
              <g>
                <line x1={left} x2={right} y1={barBaseline} y2={barBaseline} className="v62-grid-line" />
                <text x={left - 12} y={barBaseline + 4} textAnchor="end" className="v62-axis-text">
                  Δ
                </text>
              </g>
            )}
            {reference &&
              changes &&
              buckets.map((bucket, i) =>
                bucket.baseline == null || !Number.isFinite(bucket.value) ? null : (
                  <g key={bucket.date} opacity={hover != null && hover !== i ? 0.36 : 1}>
                    <rect
                      x={x(i) - Math.min(16, ((right - left) / Math.max(1, buckets.length)) * 0.32)}
                      y={barY(Math.abs(bucket.value - bucket.baseline))}
                      width={Math.min(32, ((right - left) / Math.max(1, buckets.length)) * 0.64)}
                      height={(Math.abs(bucket.value - bucket.baseline) / barMax) * barHeight}
                      rx="4"
                      className={bucket.value < bucket.baseline ? 'v62-change-bar negative' : 'v62-change-bar'}
                    />
                    <rect
                      x={x(i) - Math.min(16, ((right - left) / Math.max(1, buckets.length)) * 0.32)}
                      y={barY(Math.abs(bucket.value - bucket.baseline))}
                      width={Math.min(32, ((right - left) / Math.max(1, buckets.length)) * 0.64)}
                      height={(Math.abs(bucket.value - bucket.baseline) / barMax) * barHeight}
                      rx="4"
                      fill={`url(#stripe-${id})`}
                    />
                  </g>
                ),
              )}
            {reference && <path d={path(true)} className="v62-baseline-path" />}
            <path d={path()} className="v62-actual-path" />
            {buckets.map((b, i) =>
              b.partial ? (
                <g key={`partial-${i}`}>
                  <rect x={x(i) - 8} y={bottom - 6} width={16} height={6} fill={`url(#stripe-${id})`} />
                  {i > 0 && Number.isFinite(b.value) && Number.isFinite(buckets[i - 1].value) && (
                    <>
                      <line
                        x1={x(i - 1)}
                        x2={x(i)}
                        y1={y(buckets[i - 1].value)}
                        y2={y(b.value)}
                        stroke="var(--surface)"
                        strokeWidth={3}
                      />
                      <line
                        x1={x(i - 1)}
                        x2={x(i)}
                        y1={y(buckets[i - 1].value)}
                        y2={y(b.value)}
                        stroke="var(--accent)"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                      />
                    </>
                  )}
                </g>
              ) : null,
            )}
            {buckets.map((bucket, i) => (
              <g key={bucket.date}>
                {tickIndices.includes(i) && (
                  <text
                    x={x(i)}
                    y={height - 13}
                    className="v62-axis-text"
                    textAnchor={i === 0 ? 'start' : i === buckets.length - 1 ? 'end' : 'middle'}
                  >
                    {label(bucket.date)}
                  </text>
                )}
                {Number.isFinite(bucket.value) && bucket.dates.some((date) => anomalyDates.includes(date)) && (
                  <circle cx={x(i)} cy={y(bucket.value)} r="5" className="v62-anomaly-point" />
                )}
              </g>
            ))}
            {current && Number.isFinite(current.value) && (
              <g>
                <line x1={x(index)} x2={x(index)} y1={top - 5} y2={bottom} className="v62-cursor-line" />
                <circle cx={x(index)} cy={y(current.value)} r="4.5" className="v62-selected-point" />
                {reference && current.baseline != null && (
                  <circle cx={x(index)} cy={y(current.baseline)} r="3.5" className="v62-reference-point" />
                )}
              </g>
            )}
          </svg>
          {(hover != null || focused) && current && Number.isFinite(current.value) && (
            <div
              className="v62-chart-tip"
              role="status"
              style={{
                left: Math.max(4, Math.min(width - 210, x(index) + (x(index) > width * 0.6 ? -215 : 14))),
                top: Math.max(8, Math.min(height - 145, y(current.value) - 30)),
              }}
            >
              {' '}
              <ChartTooltip
                date={current.selectedDate}
                value={Number.isFinite(current.value) ? current.value : null}
                baseline={reference ? current.baseline : null}
                baselineLabel={reference ? '上周同日' : '基准'}
                unit={unit}
                partial={current.partial}
              />
            </div>
          )}
          {!buckets.length && (
            <div className="v62-chart-empty" role="status">
              {loading ? '正在读取趋势' : '暂无趋势数据'}
            </div>
          )}
        </div>
      )}
      <Modal
        open={details}
        onOpenChange={(open) => {
          setDetails(open);
          if (!open) requestAnimationFrame(() => moreButton.current?.focus());
        }}
        title={`${title} · 数据明细`}
        description={`${granularity === 'day' ? '日值' : '日均'} · ${unitLabel}`}
      >
        <DataTable
          rows={buckets.map((b) => ({ ...b, id: b.date }))}
          columns={[
            { key: 'date', header: '日期', render: (b) => b.date },
            { key: 'value', header: title, numeric: true, render: (b) => showValue(b.value) },
            { key: 'baseline', header: '上周同日', numeric: true, render: (b) => showValue(b.baseline) },
            {
              key: 'delta',
              header: '变化',
              numeric: true,
              render: (b) => (b.baseline == null ? '—' : showChange(b.value - b.baseline)),
            },
          ]}
        />
        <button className="v62-button" onClick={exportRows}>
          导出 CSV
        </button>
      </Modal>
    </section>
  );
}
