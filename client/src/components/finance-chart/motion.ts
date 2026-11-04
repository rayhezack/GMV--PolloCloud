import {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useCallback,
  type RefObject,
} from "react";
import { createTimeline } from "animejs";
export { useReducedMotion } from "framer-motion";
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
export function releaseStyles(...names: string[]) {
  return (animation: any) => {
    for (const target of animation.targets || [])
      if (target instanceof HTMLElement || target instanceof SVGElement)
        for (const name of names) target.style.removeProperty(name);
  };
}
export function useChartSize<T extends HTMLElement>(initial: {
  width: number;
  height: number;
}): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: {
  value?: T;
  defaultValue: T;
  onChange?: (v: T) => void;
}): [T, (v: T | ((p: T) => T)) => void] {
  const [state, setState] = useState(defaultValue);
  const current = value === undefined ? state : value;
  const currentRef = useRef(current);
  currentRef.current = current;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const controlled = value !== undefined;
  const update = useCallback(
    (v: T | ((p: T) => T)) => {
      const next =
        typeof v === "function" ? (v as (p: T) => T)(currentRef.current) : v;
      if (!controlled) setState(next);
      changeRef.current?.(next);
    },
    [controlled],
  );
  return [current, update];
}
export function useCountUp<T extends HTMLElement>(
  ref: RefObject<T | null>,
  value: number,
  format: (v: number) => string,
  options: { enabled: boolean; duration: number },
) {
  useEffect(() => {
    if (ref.current)
      ref.current.textContent = options.enabled ? format(value) : "—";
  }, [value, format, options.enabled, ref]);
}
export function useChartEntrance<T extends HTMLElement>(
  root: RefObject<T | null>,
  build: (timeline: ReturnType<typeof createTimeline>) => (() => void) | void,
) {
  const buildRef = useRef(build);
  buildRef.current = build;
  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    let cleanup: (() => void) | void;
    let timeline: ReturnType<typeof createTimeline> | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        timeline = createTimeline({ autoplay: false });
        cleanup = buildRef.current(timeline);
        timeline.play();
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      timeline?.cancel();
      if (typeof cleanup === "function") cleanup();
    };
  }, [root]);
}
