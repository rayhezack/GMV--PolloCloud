import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

/* ══ Step player ══════════════════════════════════════════
   A row of dots and a play button. The dot for the current
   step is stretched into a bar that fills while the step runs;
   when it is full the bar eases over to the next dot.

   Every dot is a pill with two edges. There is no separate bar
   travelling over the dots: changing step changes two slot widths
   and every edge eases to where its slot now is.

   The component can be controlled by a workflow (the sync panel)
   or played on its own. The loop parks itself when settled, so a
   paused player costs no animation frame.
*/

const DOT = 8;
const BAR = 36;
const GAP = 8;
const PAD = 11;
const MOVE = 420;
const easeOut = (value: number) => 1 - (1 - value) ** 3;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const stillness = () =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

const layout = (steps: number, active: number) => {
  const result: Array<[number, number]> = [];
  let left = 0;
  for (let index = 0; index < steps; index += 1) {
    const width = index === active ? BAR : DOT;
    result.push([left, left + width]);
    left += width + GAP;
  }
  return result;
};

type Edge = { value: number; from?: number; to?: number; startedAt?: number };
type DotState = { left: Edge; right: Edge; ink: number };

export const MIN_STEPS = 3;
export const MAX_STEPS = 8;

export function StepPlayer({
  steps = 5,
  pace = 3,
  wake = 100,
  activeStep,
  playing: controlledPlaying,
  readOnly = false,
}: {
  steps?: number;
  pace?: number;
  wake?: number;
  activeStep?: number;
  playing?: boolean;
  readOnly?: boolean;
} = {}) {
  const count = clamp(Math.round(steps), MIN_STEPS, MAX_STEPS);
  const reduceMotion = stillness();
  const isControlled = activeStep !== undefined || controlledPlaying !== undefined;
  const [internalStep, setInternalStep] = useState(0);
  const [internalPlaying, setInternalPlaying] = useState(false);
  const [, setTick] = useState(0);
  const currentStep = clamp(activeStep ?? internalStep, 0, count - 1);
  const playing = controlledPlaying ?? internalPlaying;
  const progress = useRef(0);
  const dots = useRef<DotState[]>([]);
  const raf = useRef(0);
  const lastFrame = useRef(0);
  const live = useRef({ currentStep, playing, count, pace });
  live.current = { currentStep, playing, count, pace };

  const slots = useMemo(() => layout(count, currentStep), [count, currentStep]);
  if (dots.current.length !== count) {
    dots.current = slots.map(([left, right], index) => ({
      left: { value: left },
      right: { value: right },
      ink: index < currentStep ? 1 : 0,
    }));
  }

  const run = () => {
    if (raf.current) return;
    const tick = (now: number) => {
      const dt = lastFrame.current
        ? clamp((now - lastFrame.current) / 16.67, 0, 2.5)
        : 1;
      lastFrame.current = now;
      const state = live.current;
      let busy = false;
      if (state.playing && !readOnly) {
        progress.current += (dt * 16.67) / (Math.max(0.5, state.pace) * 1000);
        busy = true;
        if (progress.current >= 1) {
          progress.current = 0;
          if (state.currentStep < state.count - 1) {
            setInternalStep((step) => step + 1);
          } else {
            setInternalPlaying(false);
          }
        }
      }
      const nextSlots = layout(state.count, state.currentStep);
      dots.current.forEach((dot, index) => {
        const [targetLeft, targetRight] = nextSlots[index];
        for (const [edge, target] of [
          [dot.left, targetLeft],
          [dot.right, targetRight],
        ] as const) {
          if (reduceMotion) {
            edge.value = target;
            edge.from = undefined;
            continue;
          }
          if (edge.from !== undefined && edge.to !== undefined && edge.startedAt !== undefined) {
            const t = clamp((now - edge.startedAt) / MOVE, 0, 1);
            edge.value = edge.from + (edge.to - edge.from) * easeOut(t);
            if (t >= 1) edge.from = undefined;
            busy = true;
          } else if (Math.abs(target - edge.value) > 0.02) {
            edge.value += (target - edge.value) * 0.22 * dt;
            busy = true;
          } else {
            edge.value = target;
          }
        }
        const desired = index < state.currentStep ? 1 : index === state.currentStep ? progress.current : 0;
        dot.ink += (desired - dot.ink) * Math.min(1, 0.24 * dt);
        if (Math.abs(desired - dot.ink) > 0.002) busy = true;
      });
      setTick((value) => value + 1);
      if (busy) {
        raf.current = requestAnimationFrame(tick);
      } else {
        raf.current = 0;
        lastFrame.current = 0;
      }
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const now = performance.now();
    const nextSlots = layout(count, currentStep);
    dots.current.forEach((dot, index) => {
      dot.left = reduceMotion
        ? { value: nextSlots[index][0] }
        : { value: dot.left.value, from: dot.left.value, to: nextSlots[index][0], startedAt: now };
      dot.right = reduceMotion
        ? { value: nextSlots[index][1] }
        : { value: dot.right.value, from: dot.right.value, to: nextSlots[index][1], startedAt: now };
    });
    run();
    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    // The workflow changes these values deliberately; the loop reads the rest from refs.
  }, [count, currentStep, playing, reduceMotion]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const toggle = () => {
    if (readOnly || isControlled) return;
    if (internalPlaying) setInternalPlaying(false);
    else {
      if (internalStep >= count - 1 && progress.current >= 1) {
        progress.current = 0;
        setInternalStep(0);
      }
      setInternalPlaying(true);
    }
    run();
  };

  const choose = (index: number) => {
    if (readOnly || isControlled || index === internalStep) return;
    progress.current = 0;
    setInternalStep(index);
    run();
  };

  const width = layout(count, 0).at(-1)?.[1] ?? 0;
  const rootStyle = {
    '--card': '#ffffff',
    '--fill-on': '#577c73',
    '--fill-on-rgb': '87 124 115',
    '--fill-slab': '#eef4f1',
    '--font-ui': "Inter, 'PingFang SC', system-ui, sans-serif",
    '--ink': '#384b52',
    '--ink-2': '#687873',
    '--ink-rgb': '56 75 82',
    '--pane-edge': '#dce9e4',
  } as CSSProperties;

  return (
    <div className="spl" style={rootStyle} data-playing={playing} role="group" aria-label={`步骤 ${currentStep + 1} / ${count}`}>
      <div className="spl-row">
        <div className="spl-slab" style={{ padding: PAD, borderRadius: DOT / 2 + PAD }}>
          <div className="spl-track" style={{ width, height: DOT }}>
            {dots.current.map((dot, index) => {
              const dotWidth = Math.max(0, dot.right.value - dot.left.value);
              return (
                <button
                  key={index}
                  type="button"
                  className="spl-dot"
                  aria-label={`步骤 ${index + 1}`}
                  aria-current={index === currentStep ? 'step' : undefined}
                  disabled={readOnly}
                  onClick={() => choose(index)}
                  style={{ left: dot.left.value, width: dotWidth }}
                >
                  <i
                    className="spl-ink"
                    style={{
                      width: dot.ink > 0.001 ? Math.max(Math.min(DOT, dotWidth), dotWidth * dot.ink) : 0,
                      opacity: index === currentStep ? Math.min(1, dot.ink * 14) : 1,
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        <div className="spl-slab spl-tool" style={{ width: DOT + PAD * 2, height: DOT + PAD * 2, borderRadius: DOT / 2 + PAD }}>
          <button type="button" className="spl-go" onClick={toggle} aria-label={playing ? '暂停' : '播放'} disabled={readOnly}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor">
              {playing ? <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></> : <path d="M8 5.5v13l10-6.5z" />}
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
