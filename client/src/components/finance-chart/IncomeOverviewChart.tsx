import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { animate } from "animejs";
import { ChevronRight } from "lucide-react";
import { useChartEntrance, useReducedMotion } from "./motion";
import { formatChartTooltipValue } from "@/lib/chart-tooltip-format";
import "./income-overview-chart.css";

// Adapted from the user's saved Mebius charts-income-overview source:
// labelled tracks, preview/pinned value tag, dimming, staggered growth and sheen.
type IncomeOverviewPeriod = { id: string; label: string; amount: number };

export function IncomeOverviewChart({
  periods,
  total,
  onOpen,
}: {
  periods: IncomeOverviewPeriod[];
  total: number;
  onOpen: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const active = hovered ?? focused ?? selected;
  const share = (amount: number) => (total > 0 ? amount / total : 0);
  const width = (amount: number) =>
    `${Math.min(100, Math.max(0, share(amount) * 100))}%`;
  const contentKey = periods.map((p) => `${p.id}:${p.amount}`).join("|");

  useEffect(() => {
    setSelected(null);
    setHovered(null);
    setFocused(null);
  }, [contentKey]);

  useChartEntrance(root, (timeline) => {
    const bars = Array.from(
      root.current?.querySelectorAll<HTMLElement>(".income-overview-bar") ?? [],
    );
    bars.forEach((bar, i) => {
      const at = Math.min(i, 4) * 65;
      timeline.add(bar, { scaleX: [0, 1], duration: 750, ease: "outExpo" }, at);
      const sheen = bar.querySelector<HTMLElement>(".income-overview-sheen");
      if (sheen && i < 5)
        timeline.add(
          sheen,
          {
            translateX: [0, bar.offsetWidth + 90],
            duration: 650,
            ease: "inOutSine",
          },
          at + 180,
        );
    });
    return () => bars.forEach((bar) => bar.style.removeProperty("transform"));
  });

  const sweep = (element: HTMLButtonElement) => {
    if (reduced) return;
    const sheen = element.querySelector<HTMLElement>(".income-overview-sheen");
    const bar = element.querySelector<HTMLElement>(".income-overview-bar");
    if (sheen && bar)
      animate(sheen, {
        translateX: [0, bar.offsetWidth + 90],
        duration: 550,
        ease: "inOutSine",
      });
  };
  const move = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (event.key === "Escape") {
      setSelected(null);
      setFocused(null);
      return;
    }
    const next = {
      ArrowDown: i + 1,
      ArrowUp: i - 1,
      Home: 0,
      End: periods.length - 1,
    }[event.key];
    if (next == null) return;
    event.preventDefault();
    root.current
      ?.querySelectorAll<HTMLButtonElement>(".income-overview-period")
      [Math.min(periods.length - 1, Math.max(0, next))]?.focus();
  };

  return (
    <div
      ref={root}
      className="income-overview"
      role="group"
      aria-label="分析期 GMV 分布"
    >
      <div
        className="income-overview-scroll"
        role="region"
        aria-label="滚动查看全部归因项目"
        tabIndex={0}
      >
        {periods.length ? (
          periods.map((period, i) => {
            const on = period.id === active;
            const value = formatChartTooltipValue(period.amount, "currency");
            const ratio = formatChartTooltipValue(
              share(period.amount),
              "ratio",
            );
            return (
              <div
                className="income-overview-row"
                key={period.id}
                data-active={on || undefined}
              >
                <button
                  type="button"
                  className="income-overview-period"
                  aria-label={`${period.label}，${value}，占比 ${ratio}`}
                  aria-pressed={period.id === selected}
                  onPointerEnter={(event) => {
                    setHovered(period.id);
                    sweep(event.currentTarget);
                  }}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={(event) => {
                    if (event.currentTarget.matches(":focus-visible"))
                      setFocused(period.id);
                  }}
                  onBlur={() => setFocused(null)}
                  onClick={() =>
                    setSelected((old) => (old === period.id ? null : period.id))
                  }
                  onKeyDown={(event) => move(event, i)}
                >
                  <span className="income-overview-label" title={period.label}>
                    {period.label}
                  </span>
                  <span className="income-overview-track">
                    <span
                      className="income-overview-bar"
                      style={{
                        width: width(period.amount),
                        opacity: active && !on ? 0.35 : 1,
                      }}
                    >
                      <span className="income-overview-sheen" />
                    </span>
                    {on && (
                      <span
                        className="income-overview-tag"
                        style={{
                          left: `clamp(4px, calc(${width(period.amount)} + 8px), calc(100% - 124px))`,
                        }}
                      >
                        <strong>{value}</strong>
                        <span>{ratio}</span>
                      </span>
                    )}
                  </span>
                </button>
                <button
                  className="income-overview-open"
                  type="button"
                  aria-label={`查看 ${period.label} 明细`}
                  onClick={() => onOpen(period.id)}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            );
          })
        ) : (
          <div className="income-overview-empty">暂无数据</div>
        )}
      </div>
      <div className="income-overview-axis" aria-hidden="true">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </div>
  );
}
