import { useMemo, useRef, useState } from 'react';

export type PullToRefreshRow = {
  period: string;
  value: number;
};

type PullToRefreshProps = {
  rows: PullToRefreshRow[];
  color?: string;
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
  color = '#384b52',
  formatValue = (value) => String(value),
  formatDate = (period) => period,
  ariaLabel = '趋势图',
}: PullToRefreshProps) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const values = useMemo(() => rows.map((row) => Number(row.value) || 0), [rows]);
  if (!rows.length) return <div className="pull-refresh pull-refresh-empty" aria-label={ariaLabel} />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, pointIndex) => ({
    x: rows.length === 1 ? 50 : (pointIndex / (rows.length - 1)) * 100,
    y: 92 - ((value - min) / span) * 76,
  }));
  const path = points
    .map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const activeIndex = index ?? rows.length - 1;
  const activePoint = points[activeIndex];
  const activeRow = rows[activeIndex];

  const updateFromPointer = (clientX: number) => {
    const bounds = plotRef.current?.getBoundingClientRect();
    if (!bounds || !bounds.width) return;
    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    setIndex(Math.round(ratio * (rows.length - 1)));
  };

  return (
    <div className="pull-refresh" style={{ '--pull-refresh-color': color } as React.CSSProperties}>
      <div className="pull-refresh-readout" aria-live="polite">
        <strong>{formatValue(activeRow.value)}</strong>
        <span>{formatDate(activeRow.period)}</span>
      </div>
      <div
        ref={plotRef}
        className="pull-refresh-plot"
        role="img"
        aria-label={`${ariaLabel} ${formatDate(activeRow.period)} ${formatValue(activeRow.value)}`}
        onPointerMove={(event) => updateFromPointer(event.clientX)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          updateFromPointer(event.clientX);
        }}
        onPointerLeave={() => setIndex(null)}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={path} className="pull-refresh-line" />
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
