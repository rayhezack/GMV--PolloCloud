import type { GmvAttributionType } from "../shared/api.interface";

type Scope = {
  dates: string[];
  platform: string;
  deviceType?: string;
  attributionType: GmvAttributionType;
  legacy: boolean;
};

export function paymentAnalysisSql(
  scope: Scope,
  measure: "revenue" | "cost",
  dailyOnly = false,
) {
  const filters = [
    "dataset='pay_type'",
    `period IN (${scope.dates.map(() => "?").join(",")})`,
    "platform=?",
  ];
  const binds: unknown[] = [...scope.dates, scope.platform];
  if (scope.deviceType) {
    filters.push("device_type=?");
    binds.push(scope.deviceType);
  }
  if (measure === "cost") {
    // Cost belongs to the whole creation population. Select it exactly once at
    // the double-summary grain, never join it to individual payment subtypes.
    filters.push(
      "metric_version='ads_v1'",
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
      "metric_version='ads_v1'",
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
        ? `SELECT ${dimensions},SUM(model_cost_usd) AS model_cost_usd FROM pollo_da_fact_rows WHERE ${filters.join(" AND ")} GROUP BY ${group} HAVING SUM(model_cost_usd)<>0`
        : `SELECT ${dimensions},${category} AS pay_category,pay_type,SUM(gmv_usd) AS gmv_usd FROM pollo_da_fact_rows WHERE ${filters.join(" AND ")} GROUP BY ${group},${category},pay_type`,
    binds,
  };
}
