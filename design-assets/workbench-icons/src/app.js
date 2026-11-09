// Copyright (c) 2026 Kubai087. Licensed under the Kubai Icons License; see LICENSE.
// The gallery: every icon in ORDER, a palette control and a demo switch.

const ORDER = ['chart-line', 'credit-card', 'link', 'paintbrush', 'megaphone', 'file-chart', 'database', 'shield-check', '文件夹', '邮件', '下载', '日历'];
const BY_NAME = Object.fromEntries(ICONS.map((icon) => [icon.name, icon]));
const LIST = ORDER.map((name) => BY_NAME[name]);
const N = LIST.length;

const COLORFUL = ['#5393FF', '#6366F1', '#EC4899', '#F97316', '#22C55E', '#06B6D4', '#8B5CF6', '#F43F5E', '#14B8A6', '#0284C7', '#0EA5E9', '#EF4444', '#7C3AED', '#F59E0B', '#4F46E5', '#0D9488', '#16A34A', '#D97706', '#64748B', '#DC2626'];
const spread = (list) => Array.from({ length: N }, (_, i) => list[i % list.length]);
const PALETTES = [
  { name: '彩色', colors: spread(COLORFUL), swatch: ['#5393FF', '#EC4899', '#F59E0B', '#22C55E'] },
  { name: '工作台', colors: Array(N).fill(soften('#61718A', 0.84)), edges: Array(N).fill(soften('#61718A', 0.38)), deepMarks: true },
  { name: '选中', colors: Array(N).fill(soften('#533AFD', 0.84)), edges: Array(N).fill(soften('#533AFD', 0.38)), deepMarks: true },
  clearTone('蓝灰', '#6F87B5', N),
  clearTone('青瓷', '#5BA3A8', N),
  clearTone('薄荷', '#5FAE8A', N),
  clearTone('薰衣草', '#8C83C6', N),
  clearTone('杏色', '#C9946A', N),
  flatTone('黑色', '#2E3036', N)
];
runtime.palette = PALETTES[0];

// ---------- Grid ----------
const grid = document.getElementById('grid');
const insts = LIST.map((icon, i) => {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.tabIndex = 0;
  tile.setAttribute('role', 'img');
  tile.setAttribute('aria-label', icon.name);
  if (icon.by) tile.title = `${icon.name} · @${icon.by}`;
  const host = document.createElement('span');
  host.className = 'ic';
  tile.appendChild(host);
  grid.appendChild(tile);
  const inst = mountIcon(icon, i, host);
  bind(inst, tile);
  return inst;
});

function bind(inst, el) {
  const tap = () => {
    if (inst.icon.tap) inst.s.saved = !inst.s.saved; else inst.pin = !inst.pin;
    go(inst);
  };
  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { inst.hover++; go(inst); } });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { inst.hover = Math.max(0, inst.hover - 1); go(inst); } });
  el.addEventListener('click', (e) => { if (inst.icon.tap || (e.pointerType && e.pointerType !== 'mouse')) tap(); });
  el.addEventListener('focus', () => { inst.hover++; go(inst); });
  el.addEventListener('blur', () => { inst.hover = Math.max(0, inst.hover - 1); go(inst); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tap(); } });
}

// ---------- Palette control ----------
let timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, REDUCED ? 0 : ms));
const wave = (fn, gap) => insts.forEach((inst, i) => later(() => fn(inst), i * gap));

const seg = document.getElementById('palette');
const segButtons = PALETTES.map((pal, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(i === 0));
  b.tabIndex = i === 0 ? 0 : -1;
  const dots = pal.swatch || [pal.colors[0]];
  b.innerHTML = `<span class="dots">${dots.map((c) => `<i style="background:${c}"></i>`).join('')}</span>${pal.name}`;
  b.addEventListener('click', () => choose(i));
  seg.appendChild(b);
  return b;
});
function choose(i) {
  const next = (i + PALETTES.length) % PALETTES.length;
  runtime.palette = PALETTES[next];
  segButtons.forEach((b, j) => { b.setAttribute('aria-checked', String(j === next)); b.tabIndex = j === next ? 0 : -1; });
  wave(go, 12);
  return next;
}
seg.addEventListener('keydown', (e) => {
  const cur = segButtons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  segButtons[choose(cur + step)].focus();
});

// ---------- Demo switch ----------
const sw = document.getElementById('demo');
let demoOn = false;
function demoCycle() {
  const gap = 25, span = gap * N + DUR;
  wave((inst) => { inst.demo = true; go(inst); }, gap);
  later(() => {
    wave((inst) => { inst.demo = false; go(inst); }, gap);
    later(demoCycle, span + 700);
  }, span + 1200);
}
function setDemo(on) {
  demoOn = on;
  sw.setAttribute('aria-checked', String(on));
  timers.forEach(clearTimeout);
  timers = [];
  if (on) demoCycle();
  else insts.forEach((inst) => { if (inst.demo) { inst.demo = false; go(inst); } });
}
sw.addEventListener('click', () => setDemo(!demoOn));
