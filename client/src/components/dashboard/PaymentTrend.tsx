import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChevronDown } from "lucide-react";
import { getPaymentTrend } from "@/api/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatChartTooltipValue } from "@/lib/chart-tooltip-format";
import type {
  AppDeviceType,
  DashboardPlatform,
  GmvAttributionType,
  PaymentTrendResponse,
} from "@shared/api.interface";
import {
  entityLabel,
  type PaymentGrouping,
  type RevenueScope,
} from "./payment-analysis.data";

const colors = [
  "#533afd",
  "#9884db",
  "#347f9c",
  "#ca809e",
  "#b18745",
  "#729d94",
];
const ranges = { day: "近 30 天", week: "近 12 周", month: "近 12 月" };
export default function PaymentTrend({
  platform,
  deviceType,
  analysisPeriod,
  mode,
  scope,
  grouping,
  refreshToken,
}: {
  platform: DashboardPlatform;
  deviceType?: AppDeviceType;
  analysisPeriod: string;
  mode: GmvAttributionType;
  scope: RevenueScope;
  grouping: PaymentGrouping;
  refreshToken: number;
}) {
  const [params, setParams] = useSearchParams();
  const granularity = (
    ["day", "week", "month"].includes(params.get("paymentGranularity") || "")
      ? params.get("paymentGranularity")
      : "day"
  ) as PaymentTrendResponse["granularity"];
  const [data, setData] = useState<PaymentTrendResponse | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null),
    revealed = useInView(root, { once: true }),
    reduced = useReducedMotion();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getPaymentTrend({
      platform,
      deviceType,
      analysisPeriod,
      attributionType: mode,
      granularity,
      income: scope,
      groupBy: grouping,
    })
      .then((d) => {
        if (active) {
          setData(d);
          setSelected((old) =>
            old.filter((key) => d.series.some((s) => s.key === key)).length
              ? old.filter((key) => d.series.some((s) => s.key === key))
              : d.series.slice(0, 4).map((s) => s.key),
          );
        }
      })
      .catch((e) => {
        if (active) setError(e?.response?.data?.error || "趋势读取失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    platform,
    deviceType,
    analysisPeriod,
    mode,
    scope,
    grouping,
    granularity,
    refreshToken,
    retry,
  ]);
  const shown = (data?.series || []).filter((s) => selected.includes(s.key));
  // The API keeps the full calendar window so daily averages retain their
  // observed-day denominator. The chart should only plot observed buckets;
  // null buckets create misleading blank stretches on the x-axis.
  const points = (data?.points || []).map((p, i) => ({
    period: p.period,
    ...Object.fromEntries(
      shown.map((s, n) => [
        `s${n}`,
        s.points[i]?.gmvUsd == null || !p.days
          ? null
          : s.points[i].gmvUsd! / p.days,
      ]),
    ),
  })).filter((_, i) => data!.points[i].days > 0);
  const config = Object.fromEntries(
    shown.map((s, i) => [
      `s${i}`,
      { label: entityLabel(s.label), color: colors[i % colors.length] },
    ]),
  );
  const toggle = (key: string) =>
    setSelected((current) =>
      current.includes(key)
        ? current.length > 1
          ? current.filter((k) => k !== key)
          : current
        : [...current, key],
    );
  return (
    <Card ref={root} className="payment-viz-card payment-revenue-card">
      <CardHeader className="payment-viz-head">
        <div>
          <CardTitle>
            {grouping === "payType"
              ? "付费类型趋势"
              : grouping === "actualSupplier"
                ? "渠道商趋势"
                : grouping === "actualProvider"
                  ? "厂商趋势"
                  : mode === "CREATION_MODE"
                    ? "创作功能趋势"
                    : mode === "MODEL"
                      ? "创作模型趋势"
                      : "调用模型趋势"}
          </CardTitle>
          <span className="payment-baseline">
            {ranges[granularity]} · 日均 GMV
          </span>
        </div>
        <ButtonGroup className="payment-granularity" aria-label="趋势颗粒度">
          {(["day", "week", "month"] as const).map((g) => (
            <Button
              key={g}
              variant="ghost"
              size="sm"
              aria-pressed={g === granularity}
              onClick={() =>
                setParams(
                  (p) => {
                    const next = new URLSearchParams(p);
                    next.set("paymentGranularity", g);
                    return next;
                  },
                  { replace: true },
                )
              }
            >
              {{ day: "日", week: "周", month: "月" }[g]}
            </Button>
          ))}
        </ButtonGroup>
      </CardHeader>
      <CardContent className="payment-viz-content">
        <div className="payment-series-toolbar">
          <div className="payment-series-legend">
            {shown.map((s, i) => (
              <span key={s.key}>
                <i style={{ background: colors[i % colors.length] }} />
                {entityLabel(s.label)}
              </span>
            ))}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="选择趋势类型">
                选择类型
                <ChevronDown size={12} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="payment-series-menu">
              <input
                aria-label="搜索趋势类型"
                placeholder="搜索类型"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div>
                {(data?.series || [])
                  .filter((s) =>
                    entityLabel(s.label)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((s) => (
                    <label key={s.key}>
                      <input
                        type="checkbox"
                        checked={selected.includes(s.key)}
                        onChange={() => toggle(s.key)}
                      />
                      {entityLabel(s.label)}
                    </label>
                  ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {loading ? (
          <div className="payment-line-chart" role="status" aria-label="正在读取趋势" />
        ) : error ? (
          <div className="payment-trend-state" role="alert">
            {error}
            <Button variant="ghost" onClick={() => setRetry((v) => v + 1)}>
              重试
            </Button>
          </div>
        ) : !data?.points.some((p) => p.days) ? (
          <div className="payment-trend-state">暂无数据</div>
        ) : (
          <div
            key={`${mode}-${scope}-${grouping}-${granularity}`}
            className={`payment-reveal ${revealed ? "is-revealed" : ""}`}
          >
            <ChartContainer
              className="payment-line-chart"
              config={config}
              aria-label="下钻类型日均 GMV 趋势"
            >
              <LineChart
                data={points}
                accessibilityLayer
                margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="#e8edf3"
                  strokeDasharray="3 4"
                />
                <XAxis
                  dataKey="period"
                  tickFormatter={(s: string) =>
                    granularity === "month"
                      ? s.slice(0, 7).replace("-", "/")
                      : s.slice(5, 10).replace("-", "/")
                  }
                  axisLine={false}
                  tickLine={false}
                  tickMargin={12}
                  minTickGap={26}
                />
                <YAxis
                  domain={([min, max]: [number, number]) => {
                    const pad = Math.max(
                      (max - min) * 0.15,
                      Math.abs(max) * 0.03,
                      1,
                    );
                    return [Math.max(0, min - pad), max + pad];
                  }}
                  axisLine={false}
                  tickLine={false}
                  width={54}
                  tickCount={4}
                  tickFormatter={(n: number) =>
                    `$${Math.abs(n) >= 1000 ? (n / 1000).toFixed(0) + "k" : Math.round(n)}`
                  }
                />
                <ChartTooltip
                  cursor={{ stroke: "#c5cbd9" }}
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <div className="payment-history-tooltip">
                        <strong>
                          {granularity === "month"
                            ? String(label).slice(0, 7)
                            : label}
                        </strong>
                        {payload.map((p) => (
                          <span key={String(p.dataKey)}>
                            <i style={{ background: p.color }} />
                            {config[String(p.dataKey)]?.label}
                            <b>
                              {p.value == null
                                ? "—"
                                : formatChartTooltipValue(Number(p.value), "currency")}
                            </b>
                          </span>
                        ))}
                      </div>
                    ) : null
                  }
                />
                {shown.map((s, i) => (
                  <Line
                    key={s.key}
                    dataKey={`s${i}`}
                    name={entityLabel(s.label)}
                    type="monotone"
                    stroke={colors[i % colors.length]}
                    strokeWidth={2}
                    dot={
                      s.points.filter((p) => p.gmvUsd != null).length === 1
                        ? { r: 3 }
                        : false
                    }
                    connectNulls={false}
                    isAnimationActive={!reduced}
                    animationBegin={180 + i * 70}
                    animationDuration={650}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
