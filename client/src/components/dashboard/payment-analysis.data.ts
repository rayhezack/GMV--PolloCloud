import type {
  PaymentAnalysisResponse,
  PaymentCostPoint,
  PaymentRevenuePoint,
} from "@shared/api.interface";

export type RevenueScope = "ALL" | "ACTIVE_PAYMENT" | "AUTO_RENEWAL" | "API";
export type PaymentGrouping =
  | "payType"
  | "attributionName"
  | "actualSupplier"
  | "actualProvider";
export type PaymentEntity = {
  key: string;
  baseline: number;
  gmv: number;
  change: number;
  changeRate: number | null;
  contribution: number | null;
  cost: number | null;
  baselineCost: number | null;
  costRatio: number | null;
  costChangeRate: number | null;
  costRatioChange: number | null;
};
export const attributionModes = [
  { value: "NONE", label: "大盘汇总", dimension: "付费类型" },
  { value: "CREATION_MODE", label: "创作模式", dimension: "创作功能" },
  { value: "MODEL", label: "创作模型", dimension: "创作模型" },
  { value: "ACTUAL_MODEL", label: "调用模型", dimension: "调用模型" },
] as const;
export const revenueScopes: { value: RevenueScope; label: string }[] = [
  { value: "ALL", label: "全部收入" },
  { value: "ACTIVE_PAYMENT", label: "主动付费" },
  { value: "AUTO_RENEWAL", label: "自动续订" },
  { value: "API", label: "API 收入" },
];
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
export const preciseMoney = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
export const percent = (value: number | null) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("zh-CN", {
        style: "percent",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(value);
export const signedMoney = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value))}`;
export const entityLabel = (key: string) =>
  (
    ({
      unknown_supplier: "未知渠道商",
      unknown_provider: "未知厂商",
      not_attributed: "未归因",
    }) as Record<string, string>
  )[key] || key;
export function entityKey(
  row: PaymentRevenuePoint | PaymentCostPoint,
  group: PaymentGrouping,
) {
  if (group === "payType") return "payType" in row ? row.payType : "";
  return (
    row[group] ||
    (group === "actualSupplier"
      ? "unknown_supplier"
      : group === "actualProvider"
        ? "unknown_provider"
        : "未归因")
  );
}
const offset = (row: { period: string; weekStart: string }) =>
  Math.round((Date.parse(row.period) - Date.parse(row.weekStart)) / 86400000);
const selectedRevenue = (row: PaymentRevenuePoint, scope: RevenueScope) =>
  scope === "ALL" || row.payCategory === scope;

export function buildPaymentDailyRows(
  data: PaymentAnalysisResponse,
  scope: RevenueScope,
  group: PaymentGrouping,
) {
  const rows = new Map<
    string,
    {
      period: string;
      weekStart: string;
      key: string;
      gmv: number;
      cost: number | null;
      costRatio: number | null;
    }
  >();
  const get = (r: PaymentRevenuePoint | PaymentCostPoint) => {
    const key = entityKey(r, group),
      id = r.period + "|" + key;
    if (!rows.has(id))
      rows.set(id, {
        period: r.period,
        weekStart: r.weekStart,
        key,
        gmv: 0,
        cost: data.costAvailable && group !== "payType" ? 0 : null,
        costRatio: null,
      });
    return rows.get(id)!;
  };
  for (const r of data.revenues)
    if (selectedRevenue(r, scope)) get(r).gmv += r.gmvUsd;
  if (data.costAvailable && group !== "payType")
    for (const c of data.costs) {
      const row = get(c);
      row.cost = (row.cost || 0) + c.modelCostUsd;
    }
  return [...rows.values()]
    .map((r) => ({
      ...r,
      costRatio: r.cost != null && r.gmv !== 0 ? r.cost / r.gmv : null,
    }))
    .sort(
      (a, b) =>
        b.period.localeCompare(a.period) ||
        b.gmv - a.gmv ||
        a.key.localeCompare(b.key),
    );
}

export function buildPaymentView(
  data: PaymentAnalysisResponse,
  scope: RevenueScope,
  group: PaymentGrouping,
  selected?: string,
) {
  const comparison = data.comparison;
  const analysisOffsets = new Set(
    data.revenues
      .filter((r) => r.weekStart === comparison?.analysisPeriod)
      .map(offset),
  );
  const baselineOffsets = new Set(
    data.revenues
      .filter((r) => r.weekStart === comparison?.baselinePeriod)
      .map(offset),
  );
  const aligned = (row: { weekStart: string; period: string }) =>
    analysisOffsets.has(offset(row));
  const revenue = data.revenues.filter((r) => selectedRevenue(r, scope));
  const revenueFor = (rows: PaymentRevenuePoint[], week?: string) =>
    rows
      .filter((r) => r.weekStart === week && aligned(r))
      .reduce((n, r) => n + r.gmvUsd, 0);
  const costFor = (rows: PaymentCostPoint[], week?: string) =>
    rows
      .filter((r) => r.weekStart === week && aligned(r))
      .reduce((n, r) => n + r.modelCostUsd, 0);
  const baselineDays = comparison?.baselinePeriodDays || 7;
  const analysisDays = comparison?.analysisPeriodDays || 7;
  const baseline =
    revenueFor(revenue, comparison?.baselinePeriod) / baselineDays;
  const gmv = revenueFor(revenue, comparison?.analysisPeriod) / analysisDays;
  const cost = data.costAvailable
    ? costFor(data.costs, comparison?.analysisPeriod) / analysisDays
    : null;
  const baselineCost = data.costAvailable
    ? costFor(data.costs, comparison?.baselinePeriod) / baselineDays
    : null;
  const metric = (
    key: string,
    baselineValue: number,
    value: number,
    modelCost: number | null,
    previousCost: number | null,
  ): PaymentEntity => ({
    key,
    baseline: baselineValue,
    gmv: value,
    change: value - baselineValue,
    changeRate: baselineValue ? (value - baselineValue) / baselineValue : null,
    contribution:
      gmv !== baseline ? (value - baselineValue) / (gmv - baseline) : null,
    cost: modelCost,
    baselineCost: previousCost,
    costRatio: modelCost != null && value !== 0 ? modelCost / value : null,
    costChangeRate: modelCost != null && previousCost ? (modelCost - previousCost) / previousCost : null,
    costRatioChange: modelCost != null && previousCost != null && value !== 0 && baselineValue !== 0
      ? modelCost / value - previousCost / baselineValue : null,
  });
  // Aggregate each measure separately. A model can have creation cost without
  // attributed revenue, so retain the union of revenue and cost identities.
  const byRevenue = new Map<string, PaymentRevenuePoint[]>();
  const byCost = new Map<string, PaymentCostPoint[]>();
  for (const r of revenue) {
    const k = entityKey(r, group);
    const rows = byRevenue.get(k) || [];
    rows.push(r);
    byRevenue.set(k, rows);
  }
  if (group !== "payType")
    for (const r of data.costs) {
      const k = entityKey(r, group);
      const rows = byCost.get(k) || [];
      rows.push(r);
      byCost.set(k, rows);
    }
  const items = [...new Set([...byRevenue.keys(), ...byCost.keys()])]
    .map((key) => {
      const rs = byRevenue.get(key) || [],
        cs = byCost.get(key) || [];
      const hasCost = data.costAvailable && group !== "payType";
      return metric(
        key,
        revenueFor(rs, comparison?.baselinePeriod) / baselineDays,
        revenueFor(rs, comparison?.analysisPeriod) / analysisDays,
        hasCost ? costFor(cs, comparison?.analysisPeriod) / analysisDays : null,
        hasCost ? costFor(cs, comparison?.baselinePeriod) / baselineDays : null,
      );
    })
    .sort((a, b) => b.gmv - a.gmv || a.key.localeCompare(b.key));
  const displayRevenue = selected
    ? revenue.filter((r) => entityKey(r, group) === selected)
    : revenue;
  const displayCosts =
    selected && group !== "payType"
      ? data.costs.filter((r) => entityKey(r, group) === selected)
      : selected
        ? []
        : data.costs;
  const sumDay = (week: string | undefined, day: number, costs: boolean) =>
    costs
      ? displayCosts
          .filter((r) => r.weekStart === week && offset(r) === day)
          .reduce((v, r) => v + r.modelCostUsd, 0)
      : displayRevenue
          .filter((r) => r.weekStart === week && offset(r) === day)
          .reduce((v, r) => v + r.gmvUsd, 0);
  const trend = Array.from({ length: 7 }, (_, day) => ({
    day,
    label: comparison
      ? new Date(Date.parse(comparison.analysisPeriod) + day * 86400000)
          .toISOString()
          .slice(5, 10)
          .replace("-", "/")
      : "",
    baseline: baselineOffsets.has(day)
      ? sumDay(comparison?.baselinePeriod, day, false)
      : null,
    analysis: analysisOffsets.has(day)
      ? sumDay(comparison?.analysisPeriod, day, false)
      : null,
    baselineCost: data.costAvailable && (!selected || group !== "payType") && baselineOffsets.has(day)
      ? sumDay(comparison?.baselinePeriod, day, true) : null,
    cost:
      data.costAvailable &&
      (!selected || group !== "payType") &&
      analysisOffsets.has(day)
        ? sumDay(comparison?.analysisPeriod, day, true)
        : null,
  }));
  return {
    items,
    trend,
    total: metric("全部", baseline, gmv, cost, baselineCost),
    revenue,
  };
}

/** Pivot only changes shape: each cell remains the sum of the same daily rows. */
export function buildPaymentDailyPivot(
  rows: ReturnType<typeof buildPaymentDailyRows>,
  metric: "gmv" | "cost" = "gmv",
) {
  const dates = [...new Set(rows.map((r) => r.period))].sort();
  const keys = [...new Set(rows.map((r) => r.key))];
  const cells = new Map(rows.map((r) => [`${r.key}|${r.period}`, r[metric]]));
  return {
    dates,
    rows: keys.map((key) => ({
      key,
      values: dates.map((date) => cells.get(`${key}|${date}`) ?? null),
    })),
  };
}
