import { createScope, createTimeline, type JSAnimation, type Scope, type Timeline } from "animejs"
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react"

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

/** Whether the user asked their system for reduced motion. Always false on the server. */
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  )
}

/**
 * An onComplete that removes the given inline properties from the animation's targets, so the element's classes (the
 * React state the tween animated towards) apply again. utils.cleanInlineStyles is not the same thing: it restores the
 * inline value from before the animation, which is a frame of the earlier animation it interrupted.
 */
export function releaseStyles(...properties: string[]) {
  return (animation: JSAnimation) => {
    for (const target of animation.targets) {
      if (target instanceof HTMLElement || target instanceof SVGElement) for (const property of properties) target.style.removeProperty(property)
    }
  }
}

/** useLayoutEffect in the browser, so animations set their first frame before paint; useEffect on the server. */
export const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

/**
 * An anime.js scope on `root` for as long as the component is mounted. Animations created through
 * `scope.current.execute(() => animate(…))` belong to it and are reverted on unmount, so nothing keeps
 * animating a removed chart.
 */
export function useAnimeScope(root: RefObject<HTMLElement | null>) {
  const scope = useRef<Scope | null>(null)
  useIsomorphicLayoutEffect(() => {
    scope.current = createScope({ root })
    return () => {
      scope.current?.revert()
      scope.current = null
    }
  }, [root])
  return scope
}

/** Render a complete chart before paint; business figures never count up from zero. */
export function useChartEntrance(
  root: RefObject<HTMLElement | null>,
  build: (timeline: Timeline) => void | (() => void),
  _options: { amount?: number } = {},
) {
  const buildRef = useRef(build)
  buildRef.current = build
  useIsomorphicLayoutEffect(() => {
    if (!root.current) return
    const timeline = createTimeline({ autoplay: false })
    const cleanup = buildRef.current(timeline)
    timeline.seek(timeline.duration, true)
    timeline.revert()
    // Builders restore their final SVG geometry and exact text after reverting styles.
    if (typeof cleanup === "function") cleanup()
  }, [root])
}

/**
 * Whether any of `root` is on screen, to pause an ambient loop (a shine, a breathing glow) while the chart is scrolled
 * away. True until the first observation, and always without IntersectionObserver (on the server).
 */
export function useInView(root: RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(true)
  useEffect(() => {
    const element = root.current
    if (!element || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    observer.observe(element)
    return () => observer.disconnect()
  }, [root])
  return inView
}

/** Keep displayed figures exact during scrubbing and filter changes. */
export function useCountUp(
  ref: RefObject<HTMLElement | null>,
  value: number,
  format: (value: number) => string,
  { enabled = true }: { enabled?: boolean; duration?: number } = {},
) {
  useIsomorphicLayoutEffect(() => {
    if (!ref.current || !enabled) return
    const text = format(value)
    // React already renders the exact figure. Replacing the same text node
    // again invalidates layout and wakes observers during every pointer move.
    if (ref.current.textContent !== text) ref.current.textContent = text
  }, [ref, value, format, enabled])
}
