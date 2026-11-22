import type { ReactNode } from 'react';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { HStack } from '@astryxdesign/core/HStack';
import { InfoTip } from './InfoTip';
import { day, range, shortDay } from '../../../../shared/format';
/** <PageHeader title="GMV 趋势" tools={<DateFilter/>}/> */
export function PageHeader({ title, tools }: { title: string; tools?: ReactNode }) {
  return (
    <header className="sys-page-header">
      <h1>{title}</h1>
      <div className="sys-page-tools">{tools}</div>
    </header>
  );
}
/** <PanelHeader title="主动付费" unit="日值 · USD" info="支付成功收入" tools={<Actions/>}/> */
export function PanelHeader({
  title,
  unit,
  info,
  tools,
  titleTools,
  comparison,
  inlineUnit = false,
}: {
  title: ReactNode;
  unit?: string;
  info?: ReactNode;
  tools?: ReactNode;
  titleTools?: ReactNode;
  comparison?: ReactNode;
  inlineUnit?: boolean;
}) {
  return (
    <header className="sys-panel-header">
      <Toolbar
        label={typeof title === 'string' ? title : '面板工具'}
        size="sm"
        startContent={
          <HStack gap={2} vAlign="center">
            <h2>{title}</h2>
            {unit && inlineUnit && <span className="sys-meta">{unit}</span>}
            {(info || (unit && !inlineUnit)) && (
              <InfoTip>
                {unit && !inlineUnit && <div>{unit}</div>}
                {info}
              </InfoTip>
            )}
            {titleTools}
          </HStack>
        }
        endContent={tools}
      />
      {comparison}
    </header>
  );
}
/** Keep comparison dates and aggregation beside the column they describe. */
export function PeriodHeading({
  label,
  dates = [],
  mode = 'week',
}: {
  label: string;
  dates?: string[];
  mode?: 'day' | 'week';
}) {
  const observed = [...dates].sort();
  return (
    <>
      {label}{' '}
      <InfoTip label={`${label}口径`}>
        {observed.length ? (
          <>
            <div>
              {observed[0]}
              {observed.length > 1 ? ` – ${observed.at(-1)}` : ''}
            </div>
            <div>{mode === 'week' ? `${observed.length} 天 · 同业务日日均` : '单日值'}</div>
          </>
        ) : (
          '该期日期未覆盖'
        )}
      </InfoTip>
    </>
  );
}
/** <ComparisonLabel date="2026-11-04"/>; week mode supplies matched endpoints. */
export function ComparisonLabel({
  date,
  analysis,
  baseline,
  days,
}: {
  date?: string;
  analysis?: [string, string];
  baseline?: [string, string];
  days?: number;
}) {
  return (
    <span className="sys-comparison">
      {date
        ? `${day(date)} · 较上周同日`
        : analysis && baseline
          ? `分析周 ${range(...analysis)} · 基准周 ${range(...baseline)} · 同业务日 ${days ?? '—'} 天日均`
          : '对比数据未覆盖'}
    </span>
  );
}
/** <DataFreshness date="2026-11-04" onClick={openUpdates}/> */
export function DataFreshness({ date, onClick }: { date?: string | null; onClick: () => void }) {
  return (
    <button type="button" className="sys-freshness" onClick={onClick}>
      数据至 {shortDay(date)}
    </button>
  );
}
