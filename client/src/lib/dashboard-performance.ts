// Opt-in acceptance probe (?perf=1); exports timings only, without credentials or response data.
const targets: Record<string, { title: string; selector: string }> = {
  trend: { title: 'GMV 趋势', selector: '[data-dashboard-ready="true"]' },
  payment: { title: '付费类型', selector: '[data-dashboard-ready="true"]' },
  chain: { title: '支付链路', selector: '[data-dashboard-ready="true"]' },
  ads: { title: '付费广告', selector: '[data-dashboard-ready="true"]' },
  creative: { title: '创作积极性', selector: '[data-dashboard-ready="true"]' },
};
targets.details = { title: '明细数据', selector: '[data-dashboard-ready="true"]' };
const initialView = new URLSearchParams(location.search).get('tab') || 'trend';
const output = document.createElement('output');
output.id = 'v23-performance';
output.hidden = true;
document.body.append(output);
const results: {
  firstDataMs?: number;
  navigation?: unknown;
  switches: Array<{ view: string; ms: number }>;
  frames: Array<{ samples: number; p95: number; max: number }>;
  resources: unknown[];
} = { switches: [], frames: [], resources: [] };
const publish = () => {
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (navigation)
    results.navigation = {
      ttfb: Math.round(navigation.responseStart),
      domReady: Math.round(navigation.domContentLoadedEventEnd),
    };
  if (
    results.firstDataMs === undefined &&
    document.querySelector(targets[initialView]?.selector || '[data-dashboard-ready="true"]')
  )
    results.firstDataMs = Math.round(performance.now());
  results.resources = performance
    .getEntriesByType('resource')
    .filter((e) => e.name.includes('/api/') || e.name.includes('/assets/'))
    .slice(0, 40)
    .map((e) => ({
      url: e.name.split(location.origin)[1],
      start: Math.round(e.startTime),
      ms: Math.round(e.duration),
      bytes: (e as PerformanceResourceTiming).transferSize,
    }));
  output.textContent = JSON.stringify(results);
};
let pending: { view: string; started: number; scheduled: boolean } | null = null;
document.addEventListener(
  'click',
  (event) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link) return;
    const view = new URL(link.href).searchParams.get('tab') || '';
    if (targets[view]) pending = { view, started: performance.now(), scheduled: false };
  },
  true,
);
new MutationObserver(() => {
  publish();
  const sample = pending;
  if (!sample || sample.scheduled) return;
  const target = targets[sample.view];
  if (document.querySelector('main h1')?.textContent !== target.title || !document.querySelector(target.selector))
    return;
  sample.scheduled = true;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (pending !== sample) return;
      results.switches.push({ view: sample.view, ms: Math.round(performance.now() - sample.started) });
      pending = null;
      publish();
    }),
  );
}).observe(document.getElementById('root')!, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['data-dashboard-ready'],
});
let sampling = false;
document.addEventListener(
  'pointermove',
  (event) => {
    if (sampling || !(event.target instanceof Element) || !event.target.closest('.op-growth')) return;
    sampling = true;
    let before = performance.now();
    const frames: number[] = [];
    const sample = (now: number) => {
      frames.push(now - before);
      before = now;
      if (frames.length < 60) requestAnimationFrame(sample);
      else {
        const stable = frames.slice(1).sort((a, b) => a - b);
        results.frames.push({
          samples: stable.length,
          p95: Math.round(stable[Math.floor(stable.length * 0.95)] * 10) / 10,
          max: Math.round(stable.at(-1)! * 10) / 10,
        });
        sampling = false;
        publish();
      }
    };
    requestAnimationFrame(sample);
  },
  { passive: true },
);
publish();

new PerformanceObserver(() => publish()).observe({ type: 'resource', buffered: true });
