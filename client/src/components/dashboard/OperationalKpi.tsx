import type { ReactNode } from 'react';
// WP0 removes invisible sparklines. WP6/7 will migrate this frame to KpiStrip.
export function OperationalKpi({label,value,comparison,controls,date}: {label:ReactNode;value:string;comparison:ReactNode;controls?:ReactNode;date?:string}) {
  return <article className="op-finance-card op-reading-kpi"><header><h2>{label}</h2>{controls}</header><div className="op-creative-metric-value">{value}</div><div className="op-reading-comparison">{comparison}{date&&<time dateTime={date}>{date}</time>}</div></article>;
}
