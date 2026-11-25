'use client';

import { animate, stagger, svg, utils, type AnimationParams, type JSAnimation } from 'animejs';
import * as React from 'react';

import { ChartCard } from '@/components/ui/chart-card';
import { ChartMarker } from '@/components/ui/chart-marker';
import { ChartTickLabel } from '@/components/ui/chart-tick-label';
import {
  releaseStyles,
  useChartEntrance,
  useCountUp,
  useIsomorphicLayoutEffect,
  useReducedMotion,
} from '@/hooks/use-chart-motion';
import { useChartSize } from '@/hooks/use-chart-size';
import { useControllableState } from '@/hooks/use-controllable-state';
import { alignPolylines, fittedDash, niceTicks, reachAt, smoothPath, valueAt } from '@/lib/chart-series';
import { cn } from '@/lib/utils';

type InvestmentPerformanceSeries = { key: string; label: string; color: string };
type InvestmentPerformancePoint = { date: string; values: Record<string, number> };
type InvestmentPerformanceChartProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  title: string;
  series: InvestmentPerformanceSeries[];
  data: InvestmentPerformancePoint[];
  ticks?: number[];
  plotHeight?: number;
  index?: number;
  defaultIndex?: number;
  onIndexChange?: (index: number, point: InvestmentPerformancePoint) => void;
  highlightedSeries?: string | null;
  formatDate: (date: string, context: 'axis' | 'tooltip') => string;
  formatValue: (value: number) => string;
  formatAxis: (value: number) => string;
  bands?: { from: string; to: string; label: string; kind: string }[];
};

type Point = { x: number; y: number };

// Figma geometry ("Investment Performance Chart" 1473:83433)
const PLOT_WIDTH = 625;
const DEFAULT_HEIGHT = 240;
const LEVEL_TOP = -0.5; // the highest tick's value is on the middle of its 1px grid line (over [-1, 0], above the plot)…
const TICK_COUNT = 7;
const TICK = 8; // the Icon/Normal tick marks: 8px left of the plot at every grid row, 8px under it at every month
const LINE = 2;
const CAP = 5; // the cursor's filled triangle caps: 5px long, equilateral, narrowing to the 1px line
const CAP_HALF = CAP / Math.sqrt(3);
const MARKER = 12;
const TIP_GAP = 10; // between the cursor and the tooltip
const TIP_TOP = 50; // the tooltip's top, under the plot's
const LABEL_GAP = 8; // the least space between two month labels
const DRAW_AT = 400;
const DRAW_DURATION = 1400;
const DRAW_STAGGER = 140;
const RIDE = 450;
const MORPH = 750;
const RING = 'focus-visible:ring-primary-purple-500/40'; // the card's focus rings are purple, like its tile
const NONE: string[] = [];

const timeOf = (date: string) => Date.parse(`${date}T00:00:00Z`);
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);

const round = (n: number) => Math.round(n * 1000) / 1000;

const valueOf = (point: InvestmentPerformancePoint | undefined, key: string) => {
  const value = point?.values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

/**
 * Date positions retain real elapsed time across day/week/month/year buckets. Missing observations
 * remain gaps; the registry's grid, cursor caps and smooth line geometry use the live plot size.
 */
function layoutChart(
  data: InvestmentPerformancePoint[],
  series: InvestmentPerformanceSeries[],
  hidden: string[],
  ticksProp: number[] | undefined,
  width: number,
  height: number,
) {
  const LEVEL_BOTTOM = height - 0.5;
  const shown = series.filter((s) => !hidden.includes(s.key));
  const values = (shown.length ? shown : series).flatMap((s) => data.flatMap((point) => valueOf(point, s.key) ?? []));
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 0;
  const ticks = ticksProp?.length
    ? [...ticksProp].sort((a, b) => a - b)
    : niceTicks(low, high > low ? high : low + 1, TICK_COUNT);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const level = (value: number) =>
    hi > lo ? LEVEL_BOTTOM - ((value - lo) / (hi - lo)) * (LEVEL_BOTTOM - LEVEL_TOP) : (LEVEL_TOP + LEVEL_BOTTOM) / 2;
  const times = data.map((point) => timeOf(point.date));
  const first = times[0] ?? 0;
  const last = times.at(-1) ?? first;
  const span = last - first;
  const x = (time: number) => (span > 0 ? ((time - first) / span) * width : width / 2);
  const xs = times.map(x);
  const lines = series.map((s) =>
    data.flatMap((point, i): Point[] => {
      const value = valueOf(point, s.key);
      return [{ x: xs[i], y: value === undefined ? NaN : level(value) }];
    }),
  );
  const months: { time: number; x: number }[] = [];
  const step = Math.max(1, Math.ceil((data.length - 1) / Math.max(1, Math.floor(width / 84))));
  data.forEach((point, i) => {
    if (i % step === 0 || i === data.length - 1) months.push({ time: times[i], x: xs[i] });
  });
  return { ticks, level, xs, lines, months, band: months.length > 1 ? width / (months.length - 1) : width };
}

/** The index of the x nearest to `x` in an ascending list. */
function nearest(xs: number[], x: number) {
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[hi] - x) < Math.abs(xs[lo] - x) ? hi : lo;
}

function pathFor(line: Point[]) {
  const parts: Point[][] = [];
  let part: Point[] = [];
  for (const point of line) {
    if (!Number.isFinite(point.y)) {
      if (part.length) parts.push(part);
      part = [];
    } else part.push(point);
  }
  if (part.length) parts.push(part);
  return parts.map(smoothPath).join(' ');
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />;
}

type TooltipRowData = { key: string; label: string; color: string; value: number | undefined; hidden: boolean };

/** A tooltip row: the series' dot, its name in Figma's 120px column and the day's balance (counting when it changes). */
function TooltipRow({
  row,
  format,
  counting,
}: {
  row: TooltipRowData;
  format: (value: number) => string;
  counting?: boolean;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  useCountUp(ref, row.value ?? 0, format, { duration: 400, enabled: !!counting && row.value !== undefined });
  return (
    <span
      className={cn('flex items-center gap-1.5 py-0.5 transition-opacity duration-200', row.hidden && 'opacity-40')}
    >
      <Dot color={row.color} />
      {/* the padding keeps the descenders out of truncate's clip (the text styles have a line height of 1) */}
      <span className="typo-label-02-regular -my-0.5 w-[96px] truncate py-0.5 text-fg-soft">{row.label}</span>
      <span ref={ref} className="typo-label-03-medium hug-w whitespace-nowrap text-fg-loud">
        {row.value !== undefined ? format(row.value) : '–'}
      </span>
    </span>
  );
}

/** The tooltip's day and rows. Rendered twice: visible (its amounts count) and as an invisible copy that is measured. */
function TooltipContent({
  date,
  rows,
  format,
  counting,
}: {
  date: string;
  rows: TooltipRowData[];
  format: (value: number) => string;
  counting?: boolean;
}) {
  return (
    <>
      {/* Figma "Tooltip": #1c1c1c with a 1px #242323 line along its bottom (raw colours), then the rows on
          Background/Popup, 2px under it */}
      <span className="flex bg-surface-white px-2.5 py-2 border-b border-border-soft">
        <span className="typo-label-02-regular hug-w whitespace-nowrap text-fg-soft">{date}</span>
      </span>
      <span className="flex flex-col gap-2 bg-surface-white px-2.5 py-2">
        {rows.map((row) => (
          <TooltipRow key={row.key} row={row} format={format} counting={counting} />
        ))}
      </span>
    </>
  );
}

/** Adapted from mebius charts-investment-performance; registry source archived in design-review/v63-final. */
function InvestmentPerformanceChart({
  title,
  series,
  data,
  ticks: ticksProp,
  plotHeight = DEFAULT_HEIGHT,
  index: indexProp,
  defaultIndex,
  onIndexChange,
  highlightedSeries,
  formatDate,
  formatValue,
  formatAxis,
  bands = [],
  className,
  ...props
}: InvestmentPerformanceChartProps) {
  const PLOT_HEIGHT = plotHeight;
  const CURSOR_DASH = fittedDash(PLOT_HEIGHT - 2 * CAP + 1);
  const n = data.length;
  const [indexValue, setIndex] = useControllableState({
    value: indexProp,
    defaultValue: defaultIndex ?? n - 1,
    onChange: (next: number) => {
      if (data[next]) onIndexChange?.(next, data[next]);
    },
  });
  const hidden = NONE;
  const [plotRef, plot] = useChartSize<HTMLDivElement>({ width: PLOT_WIDTH, height: PLOT_HEIGHT });
  const width = plot.width || PLOT_WIDTH;
  const chart = React.useMemo(
    () => layoutChart(data, series, hidden, ticksProp, width, PLOT_HEIGHT),
    [data, series, hidden, ticksProp, width, PLOT_HEIGHT],
  );
  const { ticks, level, xs, lines, months } = chart;
  // Content keys: parents may pass new arrays on every render, so changes are detected by value.
  const geometryKey = lines.map((line) => line.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')).join('|');
  const ticksKey = ticks.join(';');

  const money = formatValue;
  const axisMoney = formatAxis;
  const dateText = formatDate;
  const shownSeries = series;

  const [hovered, setHovered] = React.useState<number | null>(null);
  const [focused, setFocused] = React.useState(false);
  const selected = n ? Math.min(Math.max(Math.round(indexValue), 0), n - 1) : -1;
  const active = hovered !== null && hovered < n ? hovered : selected;
  const point = data[active];
  // the markers show while you scrub: the pointer over the plot, or the keyboard on it
  const scrubbing = hovered !== null || focused;
  const pointX = xs[active] ?? width / 2;
  // the cursor is centred on whole pixels like Figma's (171 on the April line, which covers [170.45, 171.45])
  const cursorX = Math.round(pointX + 0.5);
  const rows: TooltipRowData[] = series.map((s, k) => ({
    key: s.key,
    label: s.label,
    color: s.color,
    value: valueOf(point, s.key),
    hidden: hidden.includes(s.key),
  }));
  const readings = series.flatMap((s, k) => {
    const value = valueOf(point, s.key);
    return value === undefined || hidden.includes(s.key)
      ? []
      : [{ key: s.key, index: k, color: s.color, y: level(value) }];
  });

  // The tooltip sits right of the cursor, or left of it when it would run past the plot, 50px under the plot's top.
  // Its size is measured on an invisible copy that holds the final text.
  const [sizerRef, sizer] = useChartSize<HTMLSpanElement>({ width: 251, height: 140 });
  const tipWidth = sizer.width;
  const flipped = cursorX + TIP_GAP + tipWidth > width;
  const tipLeft = Math.round(flipped ? Math.max(0, cursorX - TIP_GAP - tipWidth) : cursorX + TIP_GAP);

  // The month labels: centred under their lines, but kept inside the plot's right edge. When they would crowd, every
  // second (third…) one is named, and a last label pushed in from the edge hides the one before it when they would
  // touch. The widest label is measured on an invisible copy of them all.
  const [labelsRef, labels] = useChartSize<HTMLSpanElement>({ width: 26, height: 0 });
  const labelWidth = labels.width || 26;
  const every = Math.max(1, Math.ceil((labelWidth + LABEL_GAP) / (chart.band || 1)));
  const named = months.map((_, k) => k % every === 0);
  const lastNamed = named.lastIndexOf(true);
  const beforeLast = lastNamed > 0 ? named.lastIndexOf(true, lastNamed - 1) : -1;
  if (
    beforeLast >= 0 &&
    months[beforeLast].x + 0.5 + labelWidth / 2 + LABEL_GAP >
      Math.min(months[lastNamed].x + 0.5 - labelWidth / 2, width - labelWidth)
  )
    named[beforeLast] = false;

  const reduced = useReducedMotion();
  const root = React.useRef<HTMLDivElement>(null);
  const cursorRef = React.useRef<SVGGElement>(null);
  const tipRef = React.useRef<HTMLDivElement>(null);
  // what the entrance's callbacks need at play time (the card may be resized or get new data before it is in view)
  const latest = React.useRef({ lines, cursorX });
  useIsomorphicLayoutEffect(() => {
    latest.current = { lines, cursorX };
  });
  const all = (selector: string) => Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? []);

  useChartEntrance(root, (timeline) => {
    const add = (targets: Element[], params: AnimationParams, at: number) => {
      if (targets.length) timeline.add(targets, params, at);
    };
    const paths = all('[data-slot="investment-performance-chart-line"]');
    const cursor = cursorRef.current;
    add(
      all('[data-slot="investment-performance-chart-grid-row"]'),
      { scaleX: { from: 0 }, duration: 900, ease: 'outExpo', delay: stagger(50, { from: 'last' }) },
      150,
    );
    add(
      all('[data-slot="investment-performance-chart-grid-column"]'),
      { y2: { from: 0 }, duration: 800, ease: 'outQuad', delay: stagger(35) },
      200,
    );
    add(
      all('[data-slot="investment-performance-chart-axis"]'),
      { opacity: { from: 0 }, duration: 600, ease: 'outQuad' },
      250,
    );
    add(
      all('[data-slot="chart-tick-label"]'),
      {
        opacity: { from: 0 },
        translateX: { from: -4 },
        duration: 600,
        ease: 'outQuad',
        delay: stagger(45, { from: 'last' }),
      },
      250,
    );
    add(
      all('[data-slot="investment-performance-chart-month"] > span'),
      { opacity: { from: 0 }, translateY: { from: 4 }, duration: 600, ease: 'outQuad', delay: stagger(40) },
      300,
    );
    // the lines are in the DOM back to front: the first series draws first
    paths.forEach((path, i) => {
      timeline.add(
        svg.createDrawable(path as unknown as SVGPathElement),
        { draw: ['0 0', '0 1'], duration: DRAW_DURATION, ease: 'inOutSine' },
        DRAW_AT + i * DRAW_STAGGER,
      );
    });
    // the cursor waits for the last line to reach it
    const reached = Math.max(
      DRAW_AT,
      ...latest.current.lines.map(
        (line, i) =>
          DRAW_AT +
          i * DRAW_STAGGER +
          reachAt(
            line.filter((p) => Number.isFinite(p.y)),
            latest.current.cursorX,
          ) *
            DRAW_DURATION,
      ),
    );
    if (cursor) {
      timeline
        .add(
          cursor.querySelectorAll('[data-cap="start"]'),
          { scale: { from: 0 }, duration: 400, ease: 'outBack(2.2)' },
          reached - 450,
        )
        .add(
          cursor.querySelectorAll('line'),
          { y2: { from: CAP - 0.5 }, duration: 600, ease: 'outQuad' },
          reached - 400,
        )
        .add(
          cursor.querySelectorAll('[data-cap="end"]'),
          { scale: { from: 0 }, duration: 400, ease: 'outBack(2.2)' },
          reached + 100,
        );
    }
    if (tipRef.current)
      timeline.add(
        tipRef.current,
        { opacity: { from: 0 }, translateY: { from: 6 }, scale: { from: 0.94 }, duration: 500, ease: 'outBack(1.6)' },
        reached + 120,
      );
    return () => {
      // createDrawable leaves its dash attributes (revert sets them to "hidden"): give the plain lines back
      for (const path of paths)
        for (const attribute of ['pathLength', 'stroke-dasharray', 'stroke-dashoffset'])
          path.removeAttribute(attribute);
    };
  });

  // New data, or a line turned on or off that rescales the axis, morphs the lines from what is on screen (each pair
  // resampled on the same x positions when their points differ). A resize redraws at once.
  const drawnLines = React.useRef(lines);
  const morph = React.useRef<JSAnimation | null>(null);
  const lastGeometry = React.useRef({ key: geometryKey, width });
  useIsomorphicLayoutEffect(() => {
    const before = lastGeometry.current;
    lastGeometry.current = { key: geometryKey, width };
    const target = lines;
    if (before.key === geometryKey) return;
    morph.current?.cancel();
    const paths = all('[data-slot="investment-performance-chart-line"]');
    const paint = (frame: Point[][]) => {
      drawnLines.current = frame;
      for (const path of paths) {
        const line = frame[Number(path.dataset.index)];
        if (line) path.setAttribute('d', pathFor(line));
      }
    };
    if (
      reduced ||
      before.width !== width ||
      target.some((line) => line.some((p) => !Number.isFinite(p.y))) ||
      drawnLines.current.some((line) => line.some((p) => !Number.isFinite(p.y)))
    ) {
      paint(target);
      return;
    }
    const pairs = target.map((line, i) => {
      const from = drawnLines.current[i];
      if (!from?.length || !line.length) return null;
      if (from.length === line.length && from.every((p, k) => Math.abs(p.x - line[k].x) < 1e-6))
        return { xs: line.map((p) => p.x), from: from.map((p) => p.y), to: line.map((p) => p.y) };
      return alignPolylines(from, line);
    });
    const state = { t: 0 };
    const frame = () =>
      paint(
        target.map((line, i) => {
          const pair = pairs[i];
          return pair ? pair.xs.map((x, k) => ({ x, y: pair.from[k] + (pair.to[k] - pair.from[k]) * state.t })) : line;
        }),
      );
    frame();
    morph.current = animate(state, {
      t: 1,
      duration: MORPH,
      ease: 'outExpo',
      onUpdate: frame,
      onComplete: () => paint(target),
    });
  }, [geometryKey, width, reduced]);

  // New ticks fade their labels in again (each also counts to its new value).
  const lastTicks = React.useRef(ticksKey);
  useIsomorphicLayoutEffect(() => {
    const before = lastTicks.current;
    lastTicks.current = ticksKey;
    const labels = all('[data-slot="chart-tick-label"]');
    if (before === ticksKey || reduced || !labels.length) return;
    animate(labels, {
      opacity: [0.3, 1],
      duration: 500,
      delay: stagger(35),
      ease: 'outQuad',
      onComplete: releaseStyles('opacity'),
    });
  }, [ticksKey, reduced]);

  // A new day sends the cursor and the markers riding along the lines to it (the markers follow the lines, not a
  // straight path) and slides the tooltip over; when the tooltip changes sides it pops in again. Markers that come in
  // pop.
  const drawnX = React.useRef(pointX);
  const ride = React.useRef<JSAnimation | null>(null);
  const lastRide = React.useRef({ pointX, tipLeft, flipped, scrubbing, key: geometryKey });
  useIsomorphicLayoutEffect(() => {
    const before = lastRide.current;
    lastRide.current = { pointX, tipLeft, flipped, scrubbing, key: geometryKey };
    const cursor = cursorRef.current;
    const tip = tipRef.current;
    const markers = all('[data-slot="investment-performance-chart-marker"]');
    const settle = () => {
      drawnX.current = pointX;
      cursor?.style.removeProperty('transform');
      for (const marker of markers) marker.style.removeProperty('transform');
    };
    const dots = markers.map((marker) => marker.firstElementChild).filter((el): el is Element => !!el);
    if (scrubbing && !before.scrubbing && !reduced && dots.length)
      animate(dots, { scale: [0.4, 1], duration: 350, ease: 'outBack(2)', onComplete: releaseStyles('transform') });
    if (reduced || before.key !== geometryKey) {
      ride.current?.cancel();
      settle();
      return;
    }
    if (tip && (before.tipLeft !== tipLeft || before.flipped !== flipped)) {
      if (before.flipped !== flipped)
        animate(tip, {
          opacity: [0, 1],
          scale: [0.94, 1],
          duration: 300,
          ease: 'outQuad',
          onComplete: releaseStyles('opacity', 'transform'),
        });
      else
        animate(tip, {
          translateX: [before.tipLeft - tipLeft + utils.get(tip, 'translateX', false), 0],
          duration: RIDE,
          ease: 'outExpo',
          onComplete: releaseStyles('transform'),
        });
    }
    const from = drawnX.current;
    if (from === pointX) return;
    const state = { x: from };
    const paint = () => {
      drawnX.current = state.x;
      const dx = state.x - pointX;
      if (cursor) cursor.style.transform = `translateX(${dx}px)`;
      for (const marker of markers) {
        const line = latest.current.lines[Number(marker.dataset.index)] ?? [];
        marker.style.transform = `translate(${dx}px, ${valueAt(line, state.x) - valueAt(line, pointX)}px)`;
      }
    };
    ride.current?.cancel();
    paint();
    ride.current = animate(state, { x: pointX, duration: RIDE, ease: 'outExpo', onUpdate: paint, onComplete: settle });
  }, [pointX, tipLeft, flipped, scrubbing, geometryKey, reduced]);
  React.useEffect(
    () => () => {
      morph.current?.cancel();
      ride.current?.cancel();
    },
    [],
  );

  const select = (next: number) => {
    if (n) setIndex(Math.min(Math.max(next, 0), n - 1));
  };
  // Pointer positions in the plot's own pixels (the live demo may scale the card with CSS zoom).
  const indexAt = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.currentTarget;
    const box = target.getBoundingClientRect();
    const zoom = box.width / (target.offsetWidth || box.width || 1) || 1;
    return nearest(xs, (event.clientX - box.left) / zoom);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!n) return;
    if (event.key === 'Escape') {
      setHovered(null);
      return;
    }
    // Page Up / Page Down move a month's worth of days
    const page = Math.max(1, Math.round((n - 1) / Math.max(1, months.length - 1)));
    const next = {
      ArrowRight: selected + 1,
      ArrowUp: selected + 1,
      ArrowLeft: selected - 1,
      ArrowDown: selected - 1,
      PageUp: selected + page,
      PageDown: selected - page,
      Home: 0,
      End: n - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setHovered(null);
    // keys show the markers even when the plot was focused by a click
    setFocused(true);
    select(next);
  };

  const selectedPoint = data[selected];
  const valueText = selectedPoint
    ? `${dateText(selectedPoint.date, 'tooltip')}: ${shownSeries
        .flatMap((s) => {
          const value = valueOf(selectedPoint, s.key);
          return value === undefined ? [] : [`${s.label} ${money(value)}`];
        })
        .join(', ')}`
    : undefined;
  // a legend item brings its line forward (a line that is turned off brings nothing)
  const faded = (key: string) => highlightedSeries != null && highlightedSeries !== key;

  return (
    <ChartCard
      ref={root}
      role="group"
      aria-label={title}
      className={cn('payment-investment-chart w-full gap-0 overflow-visible rounded-none p-0', className)}
      {...props}
    >
      <div className="flex items-start gap-3">
        {/* Labels use the same value scale as grid lines, including a shortened first interval. */}
        <div aria-hidden className="relative min-w-[35px] shrink-0" style={{ height: PLOT_HEIGHT }}>
          <span className="invisible block whitespace-nowrap typo-label-02-regular">
            {ticks.map(axisMoney).reduce((a, b) => (a.length >= b.length ? a : b), '')}
          </span>
          {[...ticks].reverse().map((tick, i) => (
            <ChartTickLabel
              key={i}
              value={tick}
              format={axisMoney}
              duration={MORPH}
              className="absolute left-0 -translate-y-1/2"
              style={{ top: level(tick) }}
            />
          ))}
        </div>

        {/* the 8px tick marks run in the padding left of the plot and in the margin under it */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 pl-2">
          <div
            ref={plotRef}
            data-slot="investment-performance-chart-plot"
            className="relative mb-2"
            style={{ height: PLOT_HEIGHT }}
          >
            <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
              {/* Figma "Grid Line": 1px Border/Soft over [y - 1, y] at each tick and over [x, x + 1] at each month */}
              {bands.map((band) => {
                const a = data.findIndex((p) => p.date === band.from),
                  b = data.findIndex((p) => p.date === band.to);
                if (a < 0 || b < 0) return null;
                const half = xs.length > 1 ? (xs[1] - xs[0]) / 2 : width / 2;
                const left = Math.max(0, xs[a] - half),
                  right = Math.min(width, xs[b] + half);
                return (
                  <g key={band.kind}>
                    <rect
                      x={left}
                      y={0}
                      width={right - left}
                      height={PLOT_HEIGHT}
                      fill={band.kind === 'analysis' ? 'var(--v62-accent-soft)' : 'var(--v62-selected)'}
                      opacity={0.65}
                    />
                    <text x={(left + right) / 2} y={16} textAnchor="middle" fill="var(--v62-muted)" fontSize={11}>
                      {band.label}
                    </text>
                  </g>
                );
              })}
              {ticks.map((tick, i) => (
                <line
                  key={i}
                  data-slot="investment-performance-chart-grid-row"
                  x1={0}
                  x2={width}
                  y1={round(level(tick))}
                  y2={round(level(tick))}
                  className="origin-left stroke-border-soft [transform-box:fill-box]"
                />
              ))}
              {months.map((month) => (
                <line
                  key={month.time}
                  data-slot="investment-performance-chart-grid-column"
                  x1={round(month.x + 0.5)}
                  x2={round(month.x + 0.5)}
                  y1={0}
                  y2={PLOT_HEIGHT}
                  className="stroke-border-soft"
                />
              ))}
              {/* the axes' tick marks, Icon/Normal */}
              <g data-slot="investment-performance-chart-axis" className="stroke-icon-normal">
                {ticks.map((tick, i) => (
                  <line key={i} x1={-TICK} x2={0} y1={round(level(tick))} y2={round(level(tick))} />
                ))}
                {months.map((month) => (
                  <line
                    key={month.time}
                    x1={round(month.x + 0.5)}
                    x2={round(month.x + 0.5)}
                    y1={PLOT_HEIGHT}
                    y2={PLOT_HEIGHT + TICK}
                  />
                ))}
              </g>
              {series.map((s, k) => (
                <path
                  key={s.key}
                  data-slot="investment-performance-chart-line"
                  data-index={k}
                  d={pathFor(lines[k])}
                  fill="none"
                  strokeWidth={LINE}
                  stroke={s.color}
                  className={cn(
                    'transition-opacity duration-300 motion-reduce:transition-none',
                    hidden.includes(s.key) ? 'opacity-0' : faded(s.key) && 'opacity-25',
                  )}
                />
              ))}
              {series.flatMap((s, k) =>
                lines[k].filter((p) => Number.isFinite(p.y)).length === 1
                  ? lines[k]
                      .filter((p) => Number.isFinite(p.y))
                      .map((p, i) => <circle key={`${s.key}-${i}`} cx={p.x} cy={p.y} r={3} fill={s.color} />)
                  : [],
              )}
              {point && (
                // Figma's cursor: a 1px #171717 line dashed 4/4 between two filled triangle caps
                <g ref={cursorRef} data-slot="investment-performance-chart-cursor" className="fill-primary-purple-500">
                  <line
                    x1={cursorX}
                    x2={cursorX}
                    y1={CAP - 0.5}
                    y2={PLOT_HEIGHT - CAP + 0.5}
                    className="stroke-primary-purple-500"
                    {...CURSOR_DASH}
                  />
                  <polygon
                    data-cap="start"
                    points={`${round(cursorX - CAP_HALF)},0 ${round(cursorX + CAP_HALF)},0 ${cursorX + 0.5},${CAP} ${cursorX - 0.5},${CAP}`}
                    className="origin-top [transform-box:fill-box]"
                  />
                  <polygon
                    data-cap="end"
                    points={`${round(cursorX - CAP_HALF)},${PLOT_HEIGHT} ${round(cursorX + CAP_HALF)},${PLOT_HEIGHT} ${cursorX + 0.5},${PLOT_HEIGHT - CAP} ${cursorX - 0.5},${PLOT_HEIGHT - CAP}`}
                    className="origin-bottom [transform-box:fill-box]"
                  />
                </g>
              )}
            </svg>

            {point && (
              <div
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none',
                  !scrubbing && 'opacity-0',
                )}
              >
                {readings.map((reading) => (
                  <span
                    key={reading.key}
                    data-slot="investment-performance-chart-marker"
                    data-index={reading.index}
                    className="absolute flex"
                    style={{
                      left: round(pointX - MARKER / 2),
                      top: round(reading.y - MARKER / 2),
                      width: MARKER,
                      height: MARKER,
                    }}
                  >
                    <ChartMarker
                      style={{ '--marker-color': reading.color } as React.CSSProperties}
                      className={cn('transition-opacity duration-300', faded(reading.key) && 'opacity-25')}
                    />
                  </span>
                ))}
              </div>
            )}

            <div
              role="slider"
              tabIndex={n ? 0 : -1}
              aria-label={title}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, n - 1)}
              aria-valuenow={Math.max(0, selected)}
              aria-valuetext={valueText}
              data-slot="investment-performance-chart-scrubber"
              onPointerMove={(event) => setHovered(indexAt(event))}
              onPointerLeave={() => setHovered(null)}
              onPointerUp={(event) => {
                if (event.button === 0) select(indexAt(event));
              }}
              onFocus={(event) => setFocused(event.currentTarget.matches(':focus-visible'))}
              onBlur={() => setFocused(false)}
              onKeyDown={onKeyDown}
              className={cn(
                'absolute inset-0 cursor-pointer touch-pan-y rounded-lg outline-none focus-visible:ring-2',
                RING,
              )}
            />

            {point && (
              <div
                ref={tipRef}
                aria-hidden
                data-slot="investment-performance-chart-tooltip"
                className={cn(
                  'pointer-events-none absolute z-10 flex flex-col overflow-hidden rounded-xl bg-surface-white whitespace-nowrap shadow-lg transition-opacity duration-150',
                  !scrubbing && 'invisible',
                  // Figma paints later effects on top; CSS paints the first shadow on top
                )}
                style={{ left: tipLeft, top: TIP_TOP }}
              >
                <TooltipContent date={dateText(point.date, 'tooltip')} rows={rows} format={money} counting />
                {/* Figma's 1px Border/normal inside stroke, drawn over the content */}
              </div>
            )}
            {/* the same content with its final text, measured to place the tooltip (the visible amounts change width while they count) */}
            {point && (
              <span
                ref={sizerRef}
                aria-hidden
                className="pointer-events-none invisible absolute top-0 left-0 flex flex-col gap-0.5 whitespace-nowrap"
              >
                <TooltipContent date={dateText(point.date, 'tooltip')} rows={rows} format={money} />
              </span>
            )}
          </div>

          {/* Figma lays the months out in uneven columns; each is centred under its line here (see FIGMA-GAPS.md) */}
          <div aria-hidden className="relative h-3.5">
            {months.map((month, k) =>
              named[k] ? (
                <span
                  key={month.time}
                  data-slot="investment-performance-chart-month"
                  className="absolute top-0"
                  // centred on the line, or flush with the plot's right edge when centring would run past it
                  style={{
                    left: round(month.x + 0.5),
                    translate: `min(-50%, calc(${round(width - month.x - 0.5)}px - 100%))`,
                  }}
                >
                  <span className="typo-label-02-regular block whitespace-nowrap text-fg-soft">
                    {dateText(isoDay(month.time), 'axis')}
                  </span>
                </span>
              ) : null,
            )}
            {/* every label, one per line, measured for the widest */}
            <span ref={labelsRef} className="pointer-events-none invisible absolute top-0 left-0 flex flex-col">
              {months.map((month) => (
                <span key={month.time} className="typo-label-02-regular whitespace-nowrap">
                  {dateText(isoDay(month.time), 'axis')}
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

export {
  InvestmentPerformanceChart,
  type InvestmentPerformanceChartProps,
  type InvestmentPerformancePoint,
  type InvestmentPerformanceSeries,
};
