import { useMemo, useRef, useState } from 'react';

export type PullToRefreshRow = {
  period: string;
  value: number;
};

type PullToRefreshProps = {
  rows: PullToRefreshRow[];
  compareRows?: PullToRefreshRow[];
  color?: string;
  compareColor?: string;
  compact?: boolean;
  highlightFrom?: number;
  formatValue?: (value: number) => string;
  formatDate?: (period: string) => string;
  ariaLabel?: string;
};

/*
 * This is the small, React-only part of Bencho's elastic chart block.
 * The interaction is feedback, never latency: the value and date are
 * updated from the pointer position immediately while the marker follows
 * the same curve that is painted on screen.
 */
export function PullToRefresh({
  rows,
  compareRows,
  color = '#384b52',
  compareColor = '#9b93cf',
  compact = false,
  highlightFrom,
  formatValue = (value) => String(value),
  formatDate = (period) => period,
  ariaLabel = '趋势图',
}: PullToRefreshProps) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const values = useMemo(() => rows.map((row) => Number(row.value) || 0), [rows]);
  if (!rows.length) return <div className="pull-refresh pull-refresh-empty" aria-label={ariaLabel} />;

  const compareValues = compareRows?.map((row) => Number(row.value) || 0) ?? [];
  const min = Math.min(...values, ...compareValues);
  const max = Math.max(...values, ...compareValues);
  const span = max - min || 1;
  const pointsFor = (series: number[]) => series.map((value, pointIndex) => ({
    x: series.length === 1 ? 50 : (pointIndex / (series.length - 1)) * 100,
    y: 92 - ((value - min) / span) * 76,
  }));
  const pathFor = (points: Array<{ x: number; y: number }>) => points
    .map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const points = pointsFor(values);
  const comparePoints = pointsFor(compareValues);
  const activeIndex = index ?? rows.length - 1;
  const activePoint = points[activeIndex];
  const activeRow = rows[activeIndex];
  const compareRow = compareRows?.[Math.min(activeIndex, compareRows.length - 1)];
  const highlightStart = highlightFrom === undefined || rows.length < 2
    ? null
    : Math.min(100, Math.max(0, (highlightFrom / (rows.length - 1)) * 100));

  const updateFromPointer = (clientX: number) => {
    const bounds = plotRef.current?.getBoundingClientRect();
    if (!bounds || !bounds.width) return;
    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    setIndex(Math.round(ratio * (rows.length - 1)));
  };

  return (
    <div className={`pull-refresh${compact ? ' is-compact' : ''}${compareRow ? ' is-comparison' : ''}`} style={{ '--pull-refresh-color': color, '--pull-refresh-compare-color': compareColor } as React.CSSProperties}>
      <div className="pull-refresh-readout" aria-live="polite">
        {compareRow ? <>
          <span className="pull-refresh-reading"><i />分析周 <strong>{formatValue(activeRow.value)}</strong><small>{formatDate(activeRow.period)}</small></span>
          <span className="pull-refresh-reading is-baseline"><i />基准周 <strong>{formatValue(compareRow.value)}</strong><small>{formatDate(compareRow.period)}</small></span>
        </> : <><strong>{formatValue(activeRow.value)}</strong><span>{formatDate(activeRow.period)}</span></>}
      </div>
      <div
        ref={plotRef}
        className="pull-refresh-plot"
        role="img"
        aria-label={`${ariaLabel} 分析周 ${formatDate(activeRow.period)} ${formatValue(activeRow.value)}${compareRow ? `，基准周 ${formatDate(compareRow.period)} ${formatValue(compareRow.value)}` : ''}`}
        onPointerMove={(event) => updateFromPointer(event.clientX)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          updateFromPointer(event.clientX);
        }}
        onPointerLeave={() => setIndex(null)}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {highlightStart !== null && (
            <rect className="pull-refresh-highlight" x={highlightStart} y="0" width={100 - highlightStart} height="100" />
          )}
          {compareRow && <path d={pathFor(comparePoints)} className="pull-refresh-line is-baseline" />}
          <path d={pathFor(points)} className="pull-refresh-line" />
        </svg>
        <i className="pull-refresh-guide" style={{ left: `${activePoint.x}%` }} />
        <i
          className="pull-refresh-marker"
          style={{ left: `${activePoint.x}%`, top: `${activePoint.y}%` }}
        />
      </div>
    </div>
  );
}
