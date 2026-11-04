import { useMemo, useState } from "react";
import { ArrowDownToLine, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PaymentAnalysisResponse } from "@shared/api.interface";
import {
  buildPaymentDailyRows,
  buildPaymentDailyPivot,
  entityLabel,
  percent,
  preciseMoney,
  type PaymentGrouping,
  type RevenueScope,
} from "./payment-analysis.data";
import { downloadCsv } from "./AnalysisWidgets";

export default function PaymentDailyDetail({
  data,
  scope,
  grouping,
  query,
  dimension,
}: {
  data: PaymentAnalysisResponse;
  scope: RevenueScope;
  grouping: PaymentGrouping;
  query: string;
  dimension: string;
}) {
  const [page, setPage] = useState(0),
    [shape, setShape] = useState<"long" | "wide">("long"),
    [metric, setMetric] = useState<"gmv" | "cost">("gmv");
  const rows = useMemo(
    () =>
      buildPaymentDailyRows(data, scope, grouping).filter((r) =>
        entityLabel(r.key).toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [data, scope, grouping, query],
  );
  const costAvailable = data.costAvailable && grouping !== "payType";
  const effectiveMetric = costAvailable ? metric : "gmv";
  const pivot = useMemo(
    () => buildPaymentDailyPivot(rows, effectiveMetric),
    [rows, effectiveMetric],
  );
  const length = shape === "long" ? rows.length : pivot.rows.length,
    count = Math.max(1, Math.ceil(length / 30)),
    current = Math.min(page, count - 1);
  const exportRows = () =>
    downloadCsv(
      `GMV-日明细-${data.attributionType}-${shape === "long" ? "长表" : effectiveMetric === "gmv" ? "GMV宽表" : "成本宽表"}.csv`,
      shape === "long"
        ? [
            [
              "日期",
              "业务周",
              dimension,
              "GMV_USD",
              ...(costAvailable ? ["模型成本_USD", "成本/GMV"] : []),
              "数据来源",
            ],
            ...rows.map((r) => [
              r.period,
              r.weekStart,
              entityLabel(r.key),
              r.gmv,
              ...(costAvailable ? [r.cost ?? "", r.costRatio ?? ""] : []),
              data.source,
            ]),
          ]
        : [
            [dimension, ...pivot.dates],
            ...pivot.rows.map((r) => [
              entityLabel(r.key),
              ...r.values.map((v) => v ?? ""),
            ]),
          ],
    );
  return (
    <Sheet onOpenChange={() => setPage(0)}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="payment-daily-trigger">
          <Table2 size={14} />
          日明细
        </Button>
      </SheetTrigger>
      <SheetContent className="payment-daily-sheet">
        <SheetHeader>
          <SheetTitle>逐日归因明细</SheetTitle>
          <SheetDescription className="sr-only">
            按日期查看和导出归因金额
          </SheetDescription>
        </SheetHeader>
        <div className="payment-daily-toolbar">
          <div className="payment-view-switch" aria-label="明细表布局">
            {(["long", "wide"] as const).map((s) => (
              <Button
                key={s}
                variant="ghost"
                size="sm"
                aria-pressed={shape === s}
                onClick={() => {
                  setShape(s);
                  setPage(0);
                }}
              >
                {s === "long" ? "长表" : "宽表"}
              </Button>
            ))}
          </div>
          {shape === "wide" && costAvailable && (
            <div className="payment-view-switch" aria-label="透视指标">
              {(["gmv", "cost"] as const).map((m) => (
                <Button
                  key={m}
                  variant="ghost"
                  size="sm"
                  aria-pressed={effectiveMetric === m}
                  onClick={() => setMetric(m)}
                >
                  {m === "gmv" ? "GMV" : "模型成本"}
                </Button>
              ))}
            </div>
          )}
          <Button variant="ghost" onClick={exportRows} disabled={!rows.length}>
            <ArrowDownToLine size={14} />
            {shape === "long" ? "导出长表" : "导出宽表"}
          </Button>
        </div>
        <div className="payment-daily-table">
          <Table
            aria-label={shape === "long" ? "逐日归因长表" : "逐日归因宽表"}
          >
            <TableHeader>
              <TableRow>
                {shape === "long" ? (
                  <>
                    <TableHead>日期</TableHead>
                    <TableHead>{dimension}</TableHead>
                    <TableHead>GMV</TableHead>
                    {costAvailable && (
                      <>
                        <TableHead>模型成本</TableHead>
                        <TableHead>成本 / GMV</TableHead>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <TableHead className="payment-pivot-identity">
                      {dimension}
                    </TableHead>
                    {pivot.dates.map((date) => (
                      <TableHead key={date}>{date}</TableHead>
                    ))}
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shape === "long"
                ? rows.slice(current * 30, (current + 1) * 30).map((r) => (
                    <TableRow key={r.period + r.key}>
                      <TableCell>{r.period}</TableCell>
                      <TableCell>{entityLabel(r.key)}</TableCell>
                      <TableCell>{preciseMoney(r.gmv)}</TableCell>
                      {costAvailable && (
                        <>
                          <TableCell>
                            {r.cost == null ? "—" : preciseMoney(r.cost)}
                          </TableCell>
                          <TableCell>{percent(r.costRatio)}</TableCell>
                        </>
                      )}
                    </TableRow>
                  ))
                : pivot.rows
                    .slice(current * 30, (current + 1) * 30)
                    .map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="payment-pivot-identity">
                          {entityLabel(r.key)}
                        </TableCell>
                        {r.values.map((v, i) => (
                          <TableCell key={pivot.dates[i]}>
                            {v == null ? "—" : preciseMoney(v)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
            </TableBody>
          </Table>
        </div>
        {!length && <div className="payment-no-matches">暂无数据</div>}
        <div className="payment-table-footer">
          <span>
            {current + 1} / {count}
          </span>
          <div>
            <Button
              variant="ghost"
              disabled={!current}
              onClick={() => setPage(current - 1)}
            >
              上一页
            </Button>
            <Button
              variant="ghost"
              disabled={current >= count - 1}
              onClick={() => setPage(current + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
