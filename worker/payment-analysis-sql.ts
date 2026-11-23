import type { GmvAttributionType } from "../shared/api.interface";

type Scope = {
  dates: string[];
  platform: string;
  deviceType?: string;
  attributionType: GmvAttributionType;
  legacy: boolean;
};

/** Missing counts never become zeros, even when the same slices reconcile in USD. */
export function paymentOrderTotal(rows: Record<string, unknown>[]): number | null {
  return rows.every(row => row.order_count != null && Number.isFinite(Number(row.order_count)) && Number(row.order_count) >= 0)
    ? rows.reduce((n, row) => n + Number(row.order_count), 0) : null;
}
export function paymentOrdersMatch(parents: Record<string, unknown>[], children: Record<string, unknown>[]) {
  const parent = paymentOrderTotal(parents), child = paymentOrderTotal(children);
  return parent != null && child != null && Math.abs(parent - child) < 1e-7;
}

export function paymentAnalysisSql(
  scope: Scope,
  measure: "revenue" | "cost",
  dailyOnly = false,
) {
  const filters = [
    "dataset='pay_type'",
    // Keep exact date membership (including gaps) without exceeding D1's
    // 100 bound-parameter limit for year-long trend windows.
    "period IN (SELECT value FROM json_each(?))",
    "platform=?",
  ];
  const binds: unknown[] = [JSON.stringify(scope.dates), scope.platform];
  if (scope.deviceType) {
    filters.push("device_type=?");
    binds.push(scope.deviceType);
  }
  if (measure === "cost") {
    // Cost belongs to the whole creation population. Select it exactly once at
    // the double-summary grain, never join it to individual payment subtypes.
    filters.push(
      "attribution_type=?",
      "pay_category='汇总'",
      "pay_type='汇总'",
    );
    binds.push(scope.attributionType);
  } else if (scope.legacy) {
    filters.push(
      "attribution_type IS NULL",
      "((pay_type<>'自动续订' AND function_name IS NOT NULL AND user_tag IS NOT NULL) OR (pay_type='自动续订' AND subscription_tier IS NOT NULL))",
    );
  } else {
    filters.push(
      "attribution_type=?",
      "pay_category IN ('ACTIVE_PAYMENT','AUTO_RENEWAL','API')",
      "pay_type<>'汇总'",
    );
    binds.push(scope.attributionType);
  }
  const name = scope.legacy ? "function_name" : "attribution_name";
  const category = scope.legacy
    ? "CASE WHEN pay_type='自动续订' THEN 'AUTO_RENEWAL' ELSE 'ACTIVE_PAYMENT' END"
    : "pay_category";
  const dimensions = dailyOnly
    ? "period,week_start"
    : `period,week_start,${name} AS attribution_name,actual_supplier,actual_provider`;
  const group = dailyOnly
    ? "period,week_start"
    : `period,week_start,${name},actual_supplier,actual_provider`;
  return {
    sql:
      measure === "cost"
        ? `SELECT ${dimensions},SUM(model_cost_usd) AS model_cost_usd FROM pollo_da_fact_rows_read WHERE ${filters.join(" AND ")} GROUP BY ${group} HAVING SUM(model_cost_usd)<>0`
        : `SELECT ${dimensions},${category} AS pay_category,pay_type,SUM(gmv_usd) AS gmv_usd,CASE WHEN COUNT(order_equivalent)=COUNT(*) THEN SUM(order_equivalent) ELSE NULL END AS order_count FROM pollo_da_fact_rows_read WHERE ${filters.join(" AND ")} GROUP BY ${group},${category},pay_type`,
    binds,
  };
}
