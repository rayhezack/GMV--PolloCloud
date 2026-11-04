import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Info,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { getPaymentAnalysis } from "@/api/dashboard";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatChartTooltipValue } from "@/lib/chart-tooltip-format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { downloadCsv } from "./AnalysisWidgets";
import {
  attributionModes,
  buildPaymentView,
  entityKey,
  entityLabel,
  money,
  percent,
  revenueScopes,
  signedMoney,
  type PaymentGrouping,
  type RevenueScope,
} from "./payment-analysis.data";
import type {
  AppDeviceType,
  DashboardPlatform,
  GmvAttributionType,
  PaymentAnalysisResponse,
} from "@shared/api.interface";
import "./payment-analysis.css";
import PaymentTrend from "./PaymentTrend";
import { IncomeOverviewChart } from "@/components/finance-chart/IncomeOverviewChart";
import { Search as BenchoSearch } from "@/components/bencho";
import PaymentDailyDetail from "./PaymentDailyDetail";

// Composition adapted from the user's Mebius Data Viz references:
// Revenue by Product Line (paired comparisons) and Profit Margin Analysis
// (compact linked time-series). All figures below come from ADS-backed facts.
const CHART_CONFIG = {
  baseline: { label: "基准期", color: "#b3a9e8" },
  analysis: { label: "分析期", color: "#533afd" },
  gmv: { label: "GMV", color: "#533afd" },
  cost: { label: "模型成本", color: "#9b93cf" },
  share: { label: "GMV 占比", color: "#533afd" },
};
const shortMoney = (value: number) =>
  Math.abs(value) >= 1000
    ? `$${(value / 1000).toFixed(0)}k`
    : `$${value.toFixed(0)}`;
const PAGE_SIZE = 12;
type SortKey =
  | "gmv"
  | "baseline"
  | "change"
  | "contribution"
  | "cost"
  | "costRatio";

function CostInfo() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="payment-info"
          aria-label="模型成本口径"
        >
          <Info size={14} />
        </button>
      </TooltipTrigger>
      <TooltipContent className="payment-cost-tooltip" side="top">
        模型成本覆盖当日全部创作用户，不随付费类型筛选分摊。成本 / GMV
        以当前收入范围为分母，不能解释为利润率。模型成本按任务端、GMV
        按付费端统计。
      </TooltipContent>
    </Tooltip>
  );
}

function Change({ value }: { value: number | null }) {
  return (
    <span
      className={`payment-change ${value == null || value === 0 ? "" : value > 0 ? "is-up" : "is-down"}`}
    >
      {value != null &&
        value !== 0 &&
        (value > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      {percent(value == null ? null : Math.abs(value))}
    </span>
  );
}

function RatioChange({ value }: { value: number | null }) {
  return (
    <span className="payment-change payment-cost-change">
      {value == null ? (
        "—"
      ) : (
        <>
          {value > 0 ? (
            <ArrowUp size={12} />
          ) : value < 0 ? (
            <ArrowDown size={12} />
          ) : null}
          {(Math.abs(value) * 100).toFixed(1)} pp
        </>
      )}
    </span>
  );
}

function RevenueTrend({
  trend,
  costs = false,
}: {
  trend: ReturnType<typeof buildPaymentView>["trend"];
  costs?: boolean;
}) {
  const [metric, setMetric] = useState("gmv");
  const selectedMetric = costs ? metric : "gmv";
  const ratio = selectedMetric === "ratio";
  const values = trend.map((p) => ({
    label: p.label,
    analysis:
      selectedMetric === "cost"
        ? p.cost
        : ratio
          ? p.cost != null && p.analysis
            ? p.cost / p.analysis
            : null
          : p.analysis,
    baseline:
      selectedMetric === "cost"
        ? p.baselineCost
        : ratio
          ? p.baselineCost != null && p.baseline
            ? p.baselineCost / p.baseline
            : null
          : p.baseline,
  }));
  return (
    <>
      <div className="payment-detail-trend-toolbar">
        <Legend />
        {costs && (
          <Select value={selectedMetric} onValueChange={setMetric}>
            <SelectTrigger
              className="payment-detail-metric-select"
              aria-label="详情趋势指标"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gmv">GMV</SelectItem>
              <SelectItem value="cost">模型成本</SelectItem>
              <SelectItem value="ratio">成本 / GMV</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      <ChartContainer
        className="payment-line-chart"
        config={CHART_CONFIG}
        aria-label={`${ratio ? "成本占比" : selectedMetric === "cost" ? "模型成本" : "GMV"}逐日走势`}
      >
        <AreaChart
          accessibilityLayer
          data={values}
          margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
        >
          <defs>
            <linearGradient
              id="payment-detail-area"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor="#533afd" stopOpacity={0.17} />
              <stop offset="100%" stopColor="#533afd" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="#e8edf3"
            strokeDasharray="3 4"
          />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tickMargin={12}
            minTickGap={12}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tickFormatter={ratio ? percent : shortMoney}
            width={55}
            tickCount={4}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => (
                  <span className="payment-hover-value">
                    {CHART_CONFIG[name as keyof typeof CHART_CONFIG]?.label ||
                      String(name)}
                    <strong>
                      {formatChartTooltipValue(
                        Number(value),
                        ratio ? "ratio" : "currency",
                      )}
                    </strong>
                  </span>
                )}
              />
            }
          />
          <Area
            dataKey="baseline"
            type="monotone"
            stroke="var(--color-baseline)"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            fill="none"
            connectNulls={false}
            isAnimationActive={false}
          />
          <Area
            dataKey="analysis"
            type="monotone"
            stroke="var(--color-analysis)"
            strokeWidth={2.4}
            fill="url(#payment-detail-area)"
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </>
  );
}

function Legend({ costs = false }: { costs?: boolean }) {
  return (
    <div className="payment-chart-legend">
      <span>
        <i />
        分析期
      </span>
      <span>
        <i className="is-baseline" />
        基准期
      </span>
      {costs && (
        <span>
          <i className="is-cost" />
          模型成本
        </span>
      )}
    </div>
  );
}

export default function PaymentAnalysis({
  platform,
  deviceType,
  baselinePeriod,
  analysisPeriod,
  refreshToken,
  onLoadingChange,
}: {
  platform: DashboardPlatform;
  deviceType?: AppDeviceType;
  baselinePeriod: string;
  analysisPeriod: string;
  refreshToken: number;
  onLoadingChange: (value: boolean) => void;
}) {
  const [params, setParams] = useSearchParams();
  const mode =
    attributionModes.find((m) => m.value === params.get("attributionType"))
      ?.value || "NONE";
  const scope: RevenueScope =
    revenueScopes.find((s) => s.value === params.get("income"))?.value || "ALL";
  const modeLabel = attributionModes.find((m) => m.value === mode)!.dimension;
  const groups: { value: PaymentGrouping; label: string }[] =
    mode === "NONE"
      ? [{ value: "payType", label: "付费类型" }]
      : [
          { value: "attributionName", label: modeLabel },
          { value: "payType", label: "付费类型" },
          ...(mode === "ACTUAL_MODEL"
            ? [
                { value: "actualSupplier" as const, label: "渠道商" },
                { value: "actualProvider" as const, label: "厂商" },
              ]
            : []),
        ];
  const grouping: PaymentGrouping =
    groups.find((g) => g.value === params.get("groupBy"))?.value ||
    groups[0].value;
  const dimension = groups.find((g) => g.value === grouping)!.label;
  const [data, setData] = useState<PaymentAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: "gmv",
    descending: true,
  });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const requests = useRef(new Map<string, Promise<PaymentAnalysisResponse>>());
  const update = (updates: Record<string, string | undefined>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(updates))
          value == null ? next.delete(key) : next.set(key, value);
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const key = [
      platform,
      deviceType,
      baselinePeriod,
      analysisPeriod,
      mode,
      refreshToken,
      retry,
    ].join("|");
    let request = requests.current.get(key);
    if (!request) {
      request = getPaymentAnalysis({
        platform,
        deviceType,
        baselinePeriod,
        analysisPeriod,
        attributionType: mode,
      });
      requests.current.set(key, request);
    }
    void request
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause) => {
        requests.current.delete(key);
        if (!cancelled) {
          setData(null);
          setError(
            cause?.response?.data?.error || cause?.message || "数据读取失败",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    platform,
    deviceType,
    baselinePeriod,
    analysisPeriod,
    mode,
    refreshToken,
    retry,
  ]);
  useEffect(() => {
    onLoadingChange(loading);
  }, [loading, onLoadingChange]);
  useEffect(() => {
    setPage(0);
    setSelected(null);
    setQuery("");
  }, [
    mode,
    scope,
    grouping,
    platform,
    deviceType,
    baselinePeriod,
    analysisPeriod,
  ]);
  const view = useMemo(
    () => (data ? buildPaymentView(data, scope, grouping) : null),
    [data, scope, grouping],
  );
  const detail = useMemo(
    () =>
      data && selected
        ? buildPaymentView(data, scope, grouping, selected)
        : null,
    [data, scope, grouping, selected],
  );
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const selectedItem = view?.items.find((item) => item.key === selected);
  const filtered = useMemo(() => {
    const items = (view?.items || []).filter((r) =>
      entityLabel(r.key).toLowerCase().includes(query.trim().toLowerCase()),
    );
    return [...items].sort((a, b) => {
      const x = a[sort.key],
        y = b[sort.key];
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return (sort.descending ? y - x : x - y) || a.key.localeCompare(b.key);
    });
  }, [view, query, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visiblePage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(
    visiblePage * PAGE_SIZE,
    (visiblePage + 1) * PAGE_SIZE,
  );
  const supported = data?.availableAttributionTypes.includes(mode);
  const showCosts = Boolean(data?.costAvailable);
  const entityCosts = showCosts && grouping !== "payType";
  const costView = useMemo(
    () =>
      data && showCosts
        ? buildPaymentView(
            data,
            scope,
            grouping === "payType" ? "attributionName" : grouping,
          )
        : null,
    [data, scope, grouping, showCosts],
  );
  const chartItems = showCosts
    ? [...(costView?.items || [])].sort((a, b) => (b.cost || 0) - (a.cost || 0))
    : [...(view?.items || [])].sort((a, b) => b.gmv - a.gmv);
  const sortBy = (key: SortKey) => {
    setSort((old) => ({
      key,
      descending: old.key === key ? !old.descending : true,
    }));
    setPage(0);
  };
  const header = (label: string, key: SortKey) => (
    <button type="button" onClick={() => sortBy(key)} className="payment-sort">
      {label}
      {sort.key === key ? (
        sort.descending ? (
          <ArrowDown size={12} />
        ) : (
          <ArrowUp size={12} />
        )
      ) : (
        <ArrowUpDown size={12} />
      )}
    </button>
  );
  const exportRows = () =>
    downloadCsv(`GMV-${mode}-${analysisPeriod}.csv`, [
      [
        "名称",
        "基准期日均GMV",
        "分析期日均GMV",
        "日均变化",
        "变化率",
        "贡献度",
        "日均模型成本",
        "成本/GMV",
        "基准期日均模型成本",
        "模型成本变化率",
        "成本占比变化(百分点)",
      ],
      ...filtered.map((r) => [
        entityLabel(r.key),
        r.baseline,
        r.gmv,
        r.change,
        r.changeRate ?? "",
        r.contribution ?? "",
        r.cost ?? "",
        r.costRatio ?? "",
        r.baselineCost ?? "",
        r.costChangeRate ?? "",
        r.costRatioChange == null ? "" : r.costRatioChange * 100,
      ]),
    ]);
  const detailTypes = useMemo(() => {
    if (!data || !selected) return [];
    const analysisOffsets = new Set(
      data.revenues
        .filter((r) => r.weekStart === analysisPeriod)
        .map((r) => Date.parse(r.period) - Date.parse(r.weekStart)),
    );
    const values = new Map<string, { baseline: number; analysis: number }>();
    for (const r of data.revenues) {
      if (
        entityKey(r, grouping) !== selected ||
        (scope !== "ALL" && r.payCategory !== scope) ||
        !analysisOffsets.has(Date.parse(r.period) - Date.parse(r.weekStart))
      )
        continue;
      const v = values.get(r.payType) || { baseline: 0, analysis: 0 };
      if (r.weekStart === baselinePeriod) v.baseline += r.gmvUsd;
      if (r.weekStart === analysisPeriod) v.analysis += r.gmvUsd;
      values.set(r.payType, v);
    }
    return [...values]
      .map(([key, v]) => ({
        key,
        baseline: v.baseline / (data.comparison?.baselinePeriodDays || 7),
        analysis: v.analysis / (data.comparison?.analysisPeriodDays || 7),
      }))
      .sort((a, b) => b.analysis - a.analysis);
  }, [data, selected, grouping, scope, analysisPeriod, baselinePeriod]);

  return (
    <div className="payment-bento" aria-busy={loading}>
      <Tabs
        value={mode}
        onValueChange={(value) =>
          update({ attributionType: value, groupBy: undefined })
        }
      >
        <div className="payment-bento-toolbar">
          <TabsList
            className="payment-attribution-tabs"
            aria-label="GMV 归因模式"
          >
            {attributionModes.map((m) => (
              <TabsTrigger key={m.value} value={m.value}>
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <Select
            value={scope}
            onValueChange={(value) => update({ income: value })}
          >
            <SelectTrigger
              className="payment-income-select"
              aria-label="收入范围"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {revenueScopes.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <TabsContent value={mode} className="payment-bento-content">
          {loading ? (
            <div
              className="payment-loading"
              role="status"
              aria-label="正在读取归因数据"
            >
              <div>
                <div />
                <div />
              </div>
              <div />
            </div>
          ) : error ? (
            <div className="payment-state" role="alert">
              <h2>暂时无法读取数据</h2>
              <p>{error}</p>
              <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
                重新加载
              </Button>
            </div>
          ) : !supported ? (
            <div className="payment-state">
              <h2>这个日期还没有模型归因数据</h2>
              <p>
                模型归因从 2026 年 10 月 1
                日起提供。此前历史数据可查看大盘汇总和创作模式。
              </p>
              <Button
                variant="outline"
                onClick={() =>
                  update({ attributionType: "NONE", groupBy: undefined })
                }
              >
                查看大盘汇总
              </Button>
            </div>
          ) : !view || !data?.comparison ? (
            <div className="payment-state">
              <h2>当前业务周没有足够的数据</h2>
              <p>请在右上角选择有数据的基准周和分析周。</p>
            </div>
          ) : (
            <>
              {data.source === "legacy" && (
                <div className="payment-history-note">
                  历史口径 · 2026 年 1—9 月保留旧数据
                </div>
              )}
              <div className="payment-bento-charts">
                <PaymentTrend
                  grouping={grouping}
                  platform={platform}
                  deviceType={deviceType}
                  analysisPeriod={analysisPeriod}
                  mode={mode}
                  scope={scope}
                  refreshToken={refreshToken}
                />
                <Card className="payment-viz-card payment-comparison-card">
                  <CardHeader className="payment-viz-head">
                    <div>
                      <CardTitle>
                        {showCosts ? (
                          <>
                            模型成本 <CostInfo />
                          </>
                        ) : (
                          "GMV 分布"
                        )}
                      </CardTitle>
                      <div className="payment-viz-reading">
                        <strong>
                          {showCosts
                            ? money(view.total.cost || 0)
                            : money(view.total.gmv)}
                        </strong>
                        <span>日均</span>
                        {!showCosts && <Change value={view.total.changeRate} />}
                        {showCosts && (
                          <span className="payment-cost-ratio">
                            成本 / GMV <b>{percent(view.total.costRatio)}</b>
                          </span>
                        )}
                      </div>
                      {showCosts ? (
                        <div className="payment-chart-legend">
                          <span>
                            <i />
                            GMV
                          </span>
                          <span>
                            <i className="is-cost" />
                            模型成本
                          </span>
                        </div>
                      ) : (
                        <span className="payment-baseline">{dimension}</span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="payment-viz-content">
                    {!showCosts ? (
                      <IncomeOverviewChart
                        key={`${mode}-${scope}-${grouping}`}
                        periods={chartItems.map((item) => ({
                          id: item.key,
                          label: entityLabel(item.key),
                          amount: item.gmv,
                        }))}
                        total={view.total.gmv}
                        onOpen={setSelected}
                      />
                    ) : (
                      <div
                        className="payment-comparison-scroll payment-reveal is-revealed"
                        role="region"
                        tabIndex={0}
                        aria-label="滚动查看全部归因项目"
                      >
                        <ChartContainer
                          style={{
                            height: Math.max(
                              192,
                              chartItems.length * (showCosts ? 38 : 30) + 30,
                            ),
                          }}
                          className="payment-comparison-chart"
                          config={CHART_CONFIG}
                          aria-label={
                            showCosts
                              ? "模型 GMV 与成本对比"
                              : "各项分析期 GMV 占比"
                          }
                        >
                          <BarChart
                            accessibilityLayer
                            layout="vertical"
                            data={chartItems.map((r) => ({
                              ...r,
                              name: entityLabel(r.key),
                              share: view.total.gmv
                                ? r.gmv / view.total.gmv
                                : 0,
                            }))}
                            margin={{ left: 0, right: 14, top: 0, bottom: 0 }}
                            barGap={3}
                          >
                            <CartesianGrid
                              horizontal={false}
                              stroke="#e8edf3"
                              strokeDasharray="3 4"
                            />
                            <XAxis
                              type="number"
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={showCosts ? shortMoney : percent}
                              domain={showCosts ? [0, "auto"] : [0, 1]}
                              tickCount={3}
                            />
                            <YAxis
                              type="category"
                              dataKey="name"
                              axisLine={false}
                              tickLine={false}
                              width={105}
                              tickFormatter={(v: string) =>
                                v.length > 16 ? v.slice(0, 14) + "…" : v
                              }
                            />
                            <ReferenceLine x={0} stroke="#cbd5e1" />
                            <ChartTooltip
                              cursor={{ fill: "#f6f9fc" }}
                              content={
                                <ChartTooltipContent
                                  formatter={(v, n) => (
                                    <span className="payment-hover-value">
                                      {CHART_CONFIG[
                                        n as keyof typeof CHART_CONFIG
                                      ]?.label || n}
                                      <strong>
                                        {n === "share"
                                          ? formatChartTooltipValue(
                                              Number(v),
                                              "ratio",
                                            )
                                          : formatChartTooltipValue(
                                              Number(v),
                                              "currency",
                                            )}
                                      </strong>
                                    </span>
                                  )}
                                />
                              }
                            />
                            <Bar
                              dataKey={showCosts ? "gmv" : "share"}
                              fill="#533afd"
                              radius={[0, 3, 3, 0]}
                              maxBarSize={showCosts ? 10 : 15}
                              isAnimationActive={false}
                            ></Bar>
                            {showCosts && (
                              <Bar
                                dataKey="cost"
                                fill="#9b93cf"
                                radius={[0, 3, 3, 0]}
                                maxBarSize={10}
                                isAnimationActive={false}
                              />
                            )}
                          </BarChart>
                        </ChartContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
              <Card className="payment-viz-card payment-table-card">
                <CardHeader className="payment-table-head">
                  <div className="payment-table-title">
                    <CardTitle>归因明细</CardTitle>
                    <span>{filtered.length} 项</span>
                  </div>
                  <div className="payment-table-actions">
                    {groups.length > 1 && (
                      <Select
                        value={grouping}
                        onValueChange={(value) => update({ groupBy: value })}
                      >
                        <SelectTrigger
                          className="payment-group-select"
                          aria-label="下钻维度"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {groups.map((g) => (
                            <SelectItem key={g.value} value={g.value}>
                              {g.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <BenchoSearch
                      value={query}
                      onChange={(value) => {
                        setQuery(value);
                        setPage(0);
                      }}
                      placeholder={`搜索${dimension}`}
                      width={224}
                    />
                    <ButtonGroup>
                      <PaymentDailyDetail
                        data={data}
                        scope={scope}
                        grouping={grouping}
                        query={query}
                        dimension={dimension}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={exportRows}
                        disabled={!filtered.length}
                        aria-label="导出归因明细 CSV"
                        title="导出周对比 CSV"
                      >
                        <ArrowDownToLine size={16} />
                      </Button>
                    </ButtonGroup>
                  </div>
                </CardHeader>
                <CardContent className="payment-table-content">
                  <Table aria-label={`${dimension}归因明细`}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{dimension}</TableHead>
                        <TableHead
                          aria-sort={
                            sort.key === "gmv"
                              ? sort.descending
                                ? "descending"
                                : "ascending"
                              : "none"
                          }
                        >
                          {header("分析期 GMV", "gmv")}
                        </TableHead>
                        <TableHead>
                          {header("基准期 GMV", "baseline")}
                        </TableHead>
                        <TableHead>{header("变化", "change")}</TableHead>
                        <TableHead>
                          {header("贡献度", "contribution")}
                        </TableHead>
                        {showCosts && (
                          <>
                            <TableHead>{header("模型成本", "cost")}</TableHead>
                            <TableHead>
                              <span className="payment-ratio-heading">
                                {header("成本 / GMV", "costRatio")}
                                <CostInfo />
                              </span>
                            </TableHead>
                          </>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="payment-total-row">
                        <TableCell>
                          合计<span className="payment-unit">日均 / USD</span>
                        </TableCell>
                        <TableCell>{money(view.total.gmv)}</TableCell>
                        <TableCell>{money(view.total.baseline)}</TableCell>
                        <TableCell>{signedMoney(view.total.change)}</TableCell>
                        <TableCell>
                          {view.total.change !== 0 ? "100%" : "—"}
                        </TableCell>
                        {showCosts && (
                          <>
                            <TableCell>
                              <div className="payment-cell-stack">
                                {money(view.total.cost || 0)}
                                <Change value={view.total.costChangeRate} />
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="payment-cell-stack">
                                {percent(view.total.costRatio)}
                                <RatioChange
                                  value={view.total.costRatioChange}
                                />
                              </div>
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                      {shown.map((r) => (
                        <TableRow
                          key={r.key}
                          data-state={
                            selected === r.key ? "selected" : undefined
                          }
                        >
                          <TableCell>
                            <button
                              type="button"
                              className="payment-entity"
                              onClick={() => setSelected(r.key)}
                              title={entityLabel(r.key)}
                            >
                              {entityLabel(r.key)}
                              <ChevronRight size={13} />
                            </button>
                          </TableCell>
                          <TableCell>{money(r.gmv)}</TableCell>
                          <TableCell className="payment-muted-cell">
                            {money(r.baseline)}
                          </TableCell>
                          <TableCell>
                            <div className="payment-delta">
                              {signedMoney(r.change)}
                              <Change value={r.changeRate} />
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="payment-contribution">
                              <span>{percent(r.contribution)}</span>
                              <div aria-hidden="true">
                                <i
                                  data-direction={
                                    (r.contribution || 0) < 0
                                      ? "negative"
                                      : "positive"
                                  }
                                  style={{
                                    width: `${Math.min(Math.abs(r.contribution || 0), 1) * 50}%`,
                                  }}
                                />
                              </div>
                            </div>
                          </TableCell>
                          {showCosts && (
                            <>
                              <TableCell>
                                <div className="payment-cell-stack">
                                  {entityCosts && r.cost != null
                                    ? money(r.cost)
                                    : "—"}
                                  {entityCosts && (
                                    <Change value={r.costChangeRate} />
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="payment-cell-stack">
                                  {percent(r.costRatio)}
                                  {entityCosts && (
                                    <RatioChange value={r.costRatioChange} />
                                  )}
                                </div>
                              </TableCell>
                            </>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {!filtered.length && (
                    <div className="payment-no-matches">
                      {query
                        ? `没有匹配“${query}”的${dimension}`
                        : "当前收入范围没有归因明细"}
                    </div>
                  )}
                </CardContent>
                <div className="payment-table-footer">
                  <span>
                    {filtered.length ? visiblePage * PAGE_SIZE + 1 : 0}–
                    {Math.min((visiblePage + 1) * PAGE_SIZE, filtered.length)} /{" "}
                    {filtered.length}
                  </span>
                  <div>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={visiblePage === 0}
                      onClick={() => setPage(visiblePage - 1)}
                      aria-label="上一页"
                    >
                      <ChevronLeft size={15} />
                    </Button>
                    <span>
                      {visiblePage + 1} / {pageCount}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={visiblePage >= pageCount - 1}
                      onClick={() => setPage(visiblePage + 1)}
                      aria-label="下一页"
                    >
                      <ChevronRight size={15} />
                    </Button>
                  </div>
                </div>
              </Card>
              <Sheet
                open={Boolean(selectedItem)}
                onOpenChange={(open) => {
                  if (!open) setSelected(null);
                }}
              >
                <SheetContent
                  className="payment-detail-sheet"
                  onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    detailTitleRef.current?.focus();
                  }}
                  aria-describedby="payment-detail-description"
                >
                  <SheetHeader>
                    <SheetTitle ref={detailTitleRef} tabIndex={-1}>
                      {selectedItem
                        ? entityLabel(selectedItem.key)
                        : "收入明细"}
                    </SheetTitle>
                    <SheetDescription id="payment-detail-description">
                      {dimension} · {baselinePeriod.slice(5)} 与{" "}
                      {analysisPeriod.slice(5)} · 日均 / USD
                    </SheetDescription>
                  </SheetHeader>
                  {selectedItem && detail && (
                    <>
                      <div className="payment-detail-metrics">
                        <div>
                          <span>GMV</span>
                          <strong>{money(selectedItem.gmv)}</strong>
                          <Change value={selectedItem.changeRate} />
                        </div>
                        {entityCosts && (
                          <>
                            <div>
                              <span>
                                模型成本 <CostInfo />
                              </span>
                              <strong>{money(selectedItem.cost || 0)}</strong>
                              <Change value={selectedItem.costChangeRate} />
                            </div>
                            <div>
                              <span>成本 / GMV</span>
                              <strong>{percent(selectedItem.costRatio)}</strong>
                              <RatioChange
                                value={selectedItem.costRatioChange}
                              />
                            </div>
                          </>
                        )}
                      </div>
                      <RevenueTrend trend={detail.trend} costs={entityCosts} />
                      {grouping !== "payType" && (
                        <div className="payment-detail-types">
                          <h3>付费构成</h3>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>付费类型</TableHead>
                                <TableHead>分析期</TableHead>
                                <TableHead>变化</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {detailTypes.map((r) => (
                                <TableRow key={r.key}>
                                  <TableCell>{r.key}</TableCell>
                                  <TableCell>{money(r.analysis)}</TableCell>
                                  <TableCell>
                                    {signedMoney(r.analysis - r.baseline)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          {!detailTypes.length && <p>该模型尚无归因收入。</p>}
                        </div>
                      )}
                    </>
                  )}
                </SheetContent>
              </Sheet>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
