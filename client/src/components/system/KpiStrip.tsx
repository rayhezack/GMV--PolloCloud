import type { ReactNode } from 'react';
import { DeltaBadge } from './DeltaBadge';
import { InfoTip } from './InfoTip';
/** <KpiStrip><KpiItem label="大盘 GMV" value="$143,717" change={.208}/></KpiStrip> */
export function KpiStrip({ children }: { children: ReactNode }) {
  return <div className="sys-kpi-strip">{children}</div>;
}
export function KpiItem({
  label,
  icon,
  value,
  change,
  unit,
  baseline,
  info,
  selected,
  onSelect,
  actions,
}: {
  label: string;
  icon?: ReactNode;
  value: ReactNode;
  change?: number | null;
  unit?: 'pct' | 'pp';
  baseline?: ReactNode;
  info?: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="sys-kpi" data-selected={selected || undefined}>
      <div className="sys-kpi-label">
        {icon && <span className="sys-kpi-icon">{icon}</span>}
        {label}
        {info && <InfoTip label={`${label}口径`}>{info}</InfoTip>}
      </div>
      <div className="sys-kpi-value">
        <strong>{value}</strong>
        {change !== undefined && <DeltaBadge value={change} unit={unit} />}
      </div>
      {baseline && <div className="sys-kpi-baseline">{baseline}</div>}
      {onSelect && (
        <button
          type="button"
          className="sys-kpi-select"
          aria-label={`查看${label}趋势`}
          aria-pressed={selected}
          onClick={onSelect}
        />
      )}
      <div className="sys-kpi-actions">{actions}</div>
    </div>
  );
}
