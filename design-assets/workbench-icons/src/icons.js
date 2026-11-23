// Copyright (c) 2026 Kubai087. Licensed under the Kubai Icons License; see LICENSE.
// Selected Kubai library icons (MIT) adapted to the bundled, unmodified engine.

const clamp01 = n => Math.max(0, Math.min(1, n));
const OL = 'class="ol" data-t="stroke:#5393FF"';
const LINE = 'class="ln" data-t="stroke:#D3E2FC"';
const ACC = 'class="ln" data-t="stroke:#5393FF"';
const DEEPS = 'data-t="stroke:#2F6FE0"';
const FOLDER_BACK_R = [KR, 1.4, 1.4, KR, KR, KR];
const MAIL_T = 3.3;
const today = new Date();
const tomorrow = new Date(today.getTime() + 86400000);
const ellipse = (cx, cy, rx, ry) => `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
const capsuleRing = (w, h, t) => rr(-w / 2, -h / 2, w, h, h / 2) + rr(-w / 2 + t, -h / 2 + t, w - 2 * t, h - 2 * t, (h - 2 * t) / 2);
const CARD = rr(5.2, 2.2, 20.6, 20.6, KR);
const card = (u) => `<g filter="${u.sh}"><g filter="${u.hi}"><path d="${CARD}" fill="${u.loS}"/></g></g><path d="${CARD}" ${OL}/>`;
const FILE_BADGES = [];
const pagePath = rp([[6.3, 1.5], [18.7, 1.5], [24.7, 7.5], [24.7, 23.5], [6.3, 23.5]], [KR, 0.5, 0.5, KR, KR]);
const foldPath = rp([[18.7, 1.5], [24.7, 7.5], [18.7, 7.5]], [0.4, 0.4, 1.2]);
const typedPage = (u, inner) => `<g filter="${u.sh}"><g filter="${u.hi}"><path d="${pagePath}" fill="${u.loS}"/></g></g><path d="${pagePath}" ${OL}/>${inner}<g filter="${u.hi}"><path d="${foldPath}" fill="${u.upS}"/></g><path d="${foldPath}" ${OL}/>`;
function rig(u, id, parts) {
 return parts.map((p, i) => {
  let fill = `<g data-n="${id}${i}"><path d="${p.d}" fill="${p.fill}"/></g>`;
  fill = `<g filter="${u.sh}"><g filter="${u.hi}">${fill}</g></g>`;
  return fill + `<g data-n="${id}${i}o"><path d="${p.d}" ${OL}/></g>`;
 }).join('');
}
function pose(E, id, n, transform) {
 for (let i = 0; i < n; i++) { at(E[id + i], { transform }); at(E[id + i + 'o'], { transform }); }
}

const ICONS = [
(() => {
const back = (u,d,fill) => `<g filter="${u.sh}"><g filter="${u.hi}"><path d="${d}" fill="${fill}"/></g></g><path d="${d}" ${OL}/>`;

// One coin seen from the side: a capsule 3.6 tall per step, so each coin covers the
// top of the one below and their outlines read as one line.
const slab = (x, y) => rr(x, y, 13, 4.6, 2.3);

return {
  name: 'coins',
  zh: '硬币堆',
  category: 'commerce',
  tags: ['money', 'cash', 'savings', 'stack', 'balance', '零钱'],
  variants: ['plus', 'minus', 'check', 'x', 'up', 'down', 'sync', 'clock'],
  // Two stacks of coins; on hover one more coin drops onto the front stack.
  svg: (u) => `${[16.8, 13.2, 9.6, 6].map((y) => back(u, slab(4.4, y), u.loS)).join('')}
    ${[16.8, 13.2].map((y) => back(u, slab(13.6, y), u.upS)).join('')}
    <g data-n="drop">${back(u, slab(13.6, 0), u.upS)}</g>`,
  target: (h) => ({ y: h ? 9.6 : 3.4, o: h ? 1 : 0 }),
  draw(p, E) { at(E.drop, { transform: `translate(0 ${f(p.y)})`, opacity: f(clamp01(p.o * 2)) }); }
};
})(),
(() => {
const DEEP = 'data-t="fill:#2F6FE0"';

// A dart stuck in the centre, flying in from the upper right.
const D = [Math.SQRT1_2, -Math.SQRT1_2], N = [Math.SQRT1_2, Math.SQRT1_2], T = [23, 5];
const pt = (a, b) => [T[0] + D[0] * a + N[0] * b, T[1] + D[1] * a + N[1] * b];
const FLETCH = rp([pt(-1, 0), pt(1.4, 2.2), pt(3, 2.2), pt(2.2, 0), pt(3, -2.2), pt(1.4, -2.2)], 0.4);

return {
  name: 'target',
  zh: '靶心',
  category: 'sports',
  tags: ['goal', 'aim', 'dart', 'bullseye', 'focus', '目标'],
  variants: ['check', 'star', 'clock'],
  // A target with a dart in the bullseye; on hover the dart quivers hard and comes to rest.
  svg: (u) => `<g filter="${u.sh}"><g filter="${u.hi}"><path d="${circ(15.5, 12.5, 11.5)}" fill="${u.loS}"/></g></g>
    <path d="${circ(15.5, 12.5, 11.5)}" ${OL}/>
    <path d="${circ(15.5, 12.5, 8.6)}" fill="#fff"/>
    <g filter="${u.hi}"><path d="${circ(15.5, 12.5, 5.8)}" fill="${u.loS}"/></g>
    <path d="${circ(15.5, 12.5, 2.9)}" fill="#fff"/>
    <g data-n="d"><path d="M15.5 12.5L${f(T[0])} ${f(T[1])}" fill="none" stroke-width="2.2" stroke-linecap="round" ${DEEPS}/><path d="${FLETCH}" ${DEEP}/></g>`,
  target: (h) => ({ o: h ? 1 : 0 }),
  draw(p, E) { at(E.d, { transform: `rotate(${f(13 * (1 - clamp01(p.o)) * Math.sin(3 * Math.PI * clamp01(p.o)))} 15.5 12.5)` }); }
};
})(),
(() => {
const DEEP = 'data-t="fill:#2F6FE0"';

const BAND = rp(R(4, 7.6, 23, 4.2), [KR, KR, 0, 0]);
const STICK = rp(R(4, 3, 23, 3.6), [1.6, 1.6, 0.8, 0]);
const stripes = (y0, y1, lean) => [7.6, 13.2, 18.8, 24.4].map((x) => rp([[x, y0], [x + 2.8, y0], [x + 2.8 + lean, y1], [x + lean, y1]], 0.3)).join('');

return {
  name: 'clapperboard',
  zh: '场记板',
  category: 'media',
  tags: ['clapper', 'movie', 'film', 'scene', 'take', 'video', '电影'],
  variants: ['plus', 'check'],
  // A film slate whose striped clapper swings open on its hinge on hover, ready to clap.
  svg: (u) => {
    const body = rr(4, 7.6, 23, 15, KR);
    return `<clipPath id="${u.id('b')}"><path d="${BAND}"/></clipPath><clipPath id="${u.id('s')}"><path d="${STICK}"/></clipPath>
    <g filter="${u.sh}"><path d="${body}" fill="${u.lo(15)}"/></g><path d="${body}" ${OL}/>
    <g filter="${u.hi}"><path d="${BAND}" fill="${u.upS}"/></g>
    <path d="${stripes(7.6, 11.8, -2.2)}" clip-path="url(#${u.id('b')})" ${DEEP}/>
    <path d="${BAND}" ${OL}/>
    <g filter="${u.sh}"><g filter="${u.hi}"><g data-n="st"><path d="${STICK}" fill="${u.upS}"/></g></g></g>
    <g data-n="sto"><path d="${stripes(3, 6.6, 2)}" clip-path="url(#${u.id('s')})" ${DEEP}/><path d="${STICK}" ${OL}/></g>`;
  },
  target: (h) => ({ a: h ? -20 : 0 }),
  draw(p, E) {
    const t = `rotate(${f(p.a)} 4 6.6)`;
    at(E.st, { transform: t }); at(E.sto, { transform: t });
  }
};
})(),
(() => {

const COLS = [7.6, 13.4, 19.2], ROWS = [10, 14, 18], W = 4.2, H = 2.4;

return {
  name: 'table',
  zh: '表格',
  category: 'text',
  tags: ['table', 'grid', 'sheet', 'rows', 'columns', 'data', '数据表'],
  variants: ['plus', 'minus', 'x', 'search', 'cog'],
  // A sheet with a header row and a grid of cells; on hover one row is selected cell by cell, each popping in.
  svg: (u) => {
    const body = rr(5.2, 2.2, 20.6, 20.6, KR), head = rp(R(5.2, 2.2, 20.6, 5.6), [KR, KR, 0, 0]);
    const cells = ROWS.flatMap((y) => COLS.map((x) => rr(x, y, W, H, 0.6))).join('');
    const sel = COLS.map((x) => rr(x, ROWS[1], W, H, 0.6)).join('');
    return `<g filter="${u.sh}"><path d="${body}" fill="${u.loS}"/></g><path d="${body}" ${OL}/>
      <path d="${cells}" fill="#fff"/>
      <path data-n="sel" d="${sel}" fill="${u.pure('#2F6FE0')}"/>
      <g filter="${u.hi}"><path d="${head}" fill="${u.upS}"/></g><path d="${head}" ${OL}/>`;
  },
  target: (h) => ({ o: h ? 1 : 0 }),
  draw(p, E) {
    const o = Math.max(0, Math.min(1, p.o));
    const d = o ? COLS.map((x, i) => {
      const t = Math.max(0, Math.min(1, (o - 0.2 * i) / 0.6));
      if (!t) return '';
      const s = 0.4 + 0.6 * t + 0.45 * Math.sin(Math.PI * t), cx = x + W / 2, cy = ROWS[1] + H / 2;
      return rr(cx - W * s / 2, cy - H * s / 2, W * s, H * s, 0.6);
    }).join('') : COLS.map((x) => rr(x, ROWS[1], W, H, 0.6)).join('');
    at(E.sel, { d, opacity: o ? 1 : 0 });
  }
};
})(),
(() => {

// The pie sits a little down and left so the slice pulled out up-right stays in bounds.
const CX = 14.7, CY = 13.3, RAD = 10, BASE = 20, SW = 100, MID = (BASE + SW / 2) * Math.PI / 180;

return {
  name: 'chart-pie',
  zh: '饼图',
  category: 'charts',
  tags: ['chart', 'pie', 'share', 'proportion', 'statistics', 'analytics', '占比'],
  variants: ['plus', 'x', 'search', 'cog'],
  // A pie chart; on hover one slice slides out of the pie.
  svg: (u) => {
    const rest = sector(BASE + SW, 360 - SW, RAD, CX, CY), slice = sector(BASE, SW, RAD, CX, CY);
    return `<g filter="${u.sh}"><g filter="${u.hi}"><path d="${rest}" fill="${u.loS}"/></g></g><path d="${rest}" ${OL}/>
      <g data-n="sl"><g filter="${u.sh}"><g filter="${u.hi}"><path d="${slice}" fill="${u.upS}"/></g></g><path d="${slice}" ${OL}/></g>`;
  },
  target: (h) => ({ d: h ? 2.7 : 0 }),
  draw(p, E) { at(E.sl, { transform: `translate(${f(p.d * Math.sin(MID))} ${f(-p.d * Math.cos(MID))})` }); }
};
})(),
(() => {

// An L of three blocks and a fourth block that belongs in its open corner.
const S = 8.4, X0 = 4.4, Y0 = 6.8;
const L = rp([[X0, Y0], [X0 + S, Y0], [X0 + S, Y0 + S], [X0 + 2 * S, Y0 + S], [X0 + 2 * S, Y0 + 2 * S], [X0, Y0 + 2 * S]], [KR, KR, 0.4, KR, KR, KR]);
const BLOCK = rp([[X0 + S, Y0], [X0 + 2 * S, Y0], [X0 + 2 * S, Y0 + S], [X0 + S, Y0 + S]], KR);

return {
  name: 'blocks',
  zh: '积木',
  category: 'development',
  tags: ['blocks', 'modules', 'apps', 'integrations', 'build', 'components', '模块'],
  variants: ['plus', 'check', 'x', 'search'],
  // Three joined blocks and a loose one; on hover the loose block drops into the gap.
  svg: (u) => rig(u, 'l', [{ d: L, fill: u.loS }]) + rig(u, 'b', [{ d: BLOCK, fill: u.upS }]),
  target: (h) => ({ k: h ? 0 : 1 }),
  draw(p, E) {
    const k = p.k;
    pose(E, 'b', 1, `translate(${f(4.2 * k)} ${f(-4.2 * k)}) rotate(${f(12 * k)} ${X0 + 1.5 * S} ${Y0 + 0.5 * S})`);
  }
};
})(),
(() => {
const solid = (u,d,fill) => `<g filter="${u.sh}"><g filter="${u.hi}"><path d="${d}" fill="${fill}"/></g></g><path d="${d}" ${OL}/>`;

// Two pins on each side of the package, ending 2.3 past its edge (round caps add 1.1).
const P = [12.5, 18.5];
const PINS = P.map((v) => `M${v} 4.4V2.1M${v} 20.6V22.9M7.4 ${v - 3}H5.1M23.6 ${v - 3}H25.9`).join('');

return {
  name: 'cpu',
  zh: '处理器',
  category: 'devices',
  tags: ['chip', 'processor', 'microchip', 'hardware', 'compute', '芯片'],
  variants: ['check', 'alert', 'bolt', 'cog', 'sparkle'],
  // A processor with pins on every side; on hover its core lights up.
  svg: (u) => {
    const die = rr(11.2, 8.2, 8.6, 8.6, 1.8);
    return `<path d="${PINS}" fill="none" stroke-width="2.2" stroke-linecap="round" ${DEEPS}/>
      ${solid(u, rr(7.4, 4.4, 16.2, 16.2, KR), u.loS)}
      <g filter="${u.hi}"><path d="${die}" fill="${u.upS}"/><path data-n="lit" d="${die}" fill="${u.pure('#4389FF')}"/></g><path d="${die}" ${OL}/>`;
  },
  target: (h) => ({ o: h ? 1 : 0 }),
  draw(p, E) {
    at(E.lit, { opacity: f(p.o) });
  }
};
})(),
(() => {

return {
  name: 'workflow',
  zh: '工作流',
  category: 'development',
  tags: ['flow', 'pipeline', 'automation', 'process', 'steps', '流程'],
  variants: ['plus', 'check', 'x', 'sync', 'bolt', 'clock'],
  // A start step linked to the next by an elbow; on hover the steps draw apart along the link.
  svg: (u) => `<path data-n="ln" fill="none" stroke-width="2.2" stroke-linecap="round" ${DEEPS}/>
    <g data-n="a"><g filter="${u.sh}"><g filter="${u.hi}"><path d="${rr(0, 0, 9.4, 9.4, KR)}" fill="${u.loS}"/></g></g><path d="${rr(0, 0, 9.4, 9.4, KR)}" ${OL}/></g>
    <g data-n="b"><g filter="${u.sh}"><g filter="${u.hi}"><path d="${rr(0, 0, 9.4, 9.4, KR)}" fill="${u.upS}"/></g></g><path d="${rr(0, 0, 9.4, 9.4, KR)}" ${OL}/></g>`,
  target: (h) => ({ a: h ? [3.8, 14.4] : [4.8, 13.4], b: h ? [17.8, 0.8] : [16.8, 1.8] }),
  draw(p, E) {
    const [ax, ay] = p.a, [bx, by] = p.b;
    at(E.a, { transform: `translate(${f(ax)} ${f(ay)})` }); at(E.b, { transform: `translate(${f(bx)} ${f(by)})` });
    const x = ax + 4.7, y = by + 4.7;
    at(E.ln, { d: `M${f(x)} ${f(ay + 1)}V${f(y + 3)}Q${f(x)} ${f(y)} ${f(x + 3)} ${f(y)}H${f(bx + 1)}` });
  }
};
})(),
  (() => {
// Kubai library rocket (MIT): static feature release marker.
const DEEP = 'data-t="fill:#2F6FE0"';
const BODY = 'M15.5 1C19.9 3.6 21.4 8.2 21.4 12.8V17.4Q21.4 18.6 20.2 18.6H10.8Q9.6 18.6 9.6 17.4V12.8C9.6 8.2 11.1 3.6 15.5 1Z';
const FINS = rp([[9.8, 12], [9.8, 18.6], [5.4, 21.4], [5.4, 16.4]], [0, 0, 1.2, 1.4]) + rp([[21.2, 12], [25.6, 16.4], [25.6, 21.4], [21.2, 18.6]], [0, 1.4, 1.2, 0]);
const FLAME = 'M15.5 26.4C13.2 24.8 12.6 22.6 13 20.4H18C18.4 22.6 17.8 24.8 15.5 26.4Z';

return {
  name: 'rocket',
  zh: '火箭',
  category: 'transport',
  tags: ['launch', 'space', 'startup', 'boost', 'ship', '发射'],
  variants: ['check', 'clock'],
  // A rocket on the pad; on hover its engine fires and it lifts off.
  svg: (u) => `<g data-n="r">
    <g data-n="fl"><g filter="${u.hi}"><path d="${FLAME}" fill="${u.upS}"/></g><path d="${FLAME}" ${OL}/></g>
    <path d="${rr(12.6, 17.6, 5.8, 3, 0.8)}" ${DEEP}/>
    <g filter="${u.sh}"><g filter="${u.hi}"><path d="${FINS}" fill="${u.upS}"/></g></g><path d="${FINS}" ${OL}/>
    <g filter="${u.sh}"><g filter="${u.hi}"><path d="${BODY}" fill="${u.loS}"/></g></g><path d="${BODY}" ${OL}/>
    <circle cx="15.5" cy="9.6" r="2.6" fill="#fff"/></g>`,
  target: () => ({ y: 1.2, fl: 0 }),
  draw(p, E) {
    at(E.r, { transform: `translate(0 ${f(p.y)})` });
    const s = Math.max(0.001, clamp01(p.fl));
    at(E.fl, { transform: `translate(15.5 20.4) scale(${f(0.7 + 0.3 * s)} ${f(s)}) translate(-15.5 -20.4)`, opacity: f(s) });
  }
};
})(),
  {
    name: 'workspace',
    // A desktop window: its white panes open apart as the workspace is explored.
    svg: u => `<g filter="${u.sh}"><g filter="${u.hi}"><path d="${rr(4,3.3,23,18.4,KR)}" fill="${u.loS}"/></g></g><path d="${rr(4,3.3,23,18.4,KR)}" ${OL}/><g filter="${u.hi}"><path d="${rp(R(4,3.3,23,5.2),[KR,KR,0,0])}" fill="${u.upS}"/></g><g data-n="panes"><path d="${rr(6.8,11,5.2,7.8,CR)}" fill="#fff"/><path d="${rr(14.5,11,9.7,7.8,CR)}" fill="#fff"/></g>`,
    target: h => ({ lift: h ? -0.4 : 0 }),
    draw(p,E) { at(E.panes, { transform: `translate(0 ${f(p.lift)})` }); }
  },
  {
    name: '搜索',
    // The page is the subject; the lens is a supporting mark on its corner, a solid
    // ring with no inner outline so it never leaves a thin band.
    svg: (u) => `
      <g filter="${u.sh}"><g filter="${u.hi}"><path d="${rr(4, 1, 16.8, 20.2, KR)}" fill="${u.lo(20.2)}"/></g></g>
      <path d="${rr(4, 1, 16.8, 20.2, KR)}" ${OL}/>
      <path d="${lines(7.4, 4.8, [10, 6.6])}" class="ln" stroke="#fff" data-w="stroke"/>
      <g filter="${u.hi}"><path d="${rp(R(4, 10.8, 16.8, 10.4), [1.6, 1.6, KR, KR])}" fill="${u.upS}"/></g>
      <path d="${rp(R(4, 10.8, 16.8, 10.4), [1.6, 1.6, KR, KR])}" ${OL}/>
      <g data-n="lens" filter="${u.sh}">
        <circle r="3.6" fill="#fff" fill-opacity=".8"/>
        <circle r="3.6" fill="${u.upS}" fill-opacity=".35"/>
        <circle r="4.5" fill="none" stroke-width="1.8" data-t="stroke:#2F6FE0"/>
        <path d="M3.8 3.8L6.6 6.6" stroke-width="2.2" stroke-linecap="round" data-t="stroke:#2F6FE0"/>
      </g>`,
    target: (h) => ({ lens: h ? [13.2, 10.4, 1.05] : [19.8, 16.8, 1] }),
    draw(p, E) {
      const [x, y, s] = p.lens;
      at(E.lens, { transform: `translate(${f(x)} ${f(y)}) scale(${f(s)})` });
    }
  },
  {
    name: 'bell',
    // A bell with a separate clapper; ringing settles back to its upright rest.
    svg: u => `<g data-n="bell"><g filter="${u.sh}"><path d="M6 18.5Q8 16 8 10A7.5 7.5 0 0 1 23 10Q23 16 25 18.5Z" fill="${u.loS}"/></g><path d="M6 18.5Q8 16 8 10A7.5 7.5 0 0 1 23 10Q23 16 25 18.5Z" ${OL}/><circle cx="15.5" cy="21.5" r="2.4" fill="${u.loS}" ${OL}/><g filter="${u.hi}"><path d="${rr(4,16.3,23,3.8,1.8)}" fill="${u.upS}"/></g><path d="${rr(4,16.3,23,3.8,1.8)}" ${OL}/></g>`,
    target: h => ({ progress: h ? 1 : 0 }),
    draw(p,E) { const angle = 18 * (1-p.progress) * Math.sin(3*Math.PI*p.progress); at(E.bell,{ transform:`rotate(${f(angle)} 15.5 4)` }); }
  },

(() => {

const XS = [9, 13.2, 17.6, 22];

return {
  name: 'chart-line',
  zh: '折线图',
  category: 'charts',
  tags: ['chart', 'graph', 'line chart', 'trend', 'statistics', 'analytics', '趋势'],
  variants: ['plus', 'x', 'search', 'sparkle'],
  // A line chart on a card; on hover the line redraws to new, rising values.
  svg: (u) => `${card(u)}<path data-n="ln" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" stroke="#fff" data-w="stroke"/>`,
  target: (h) => ({ ys: h ? [17.2, 12.2, 13, 6.4] : [16.6, 11.4, 14.8, 8.6] }),
  draw(p, E) { at(E.ln, { d: poly(XS.map((x, i) => [x, p.ys[i]])) }); }
};
})(),
(() => {

return {
  name: 'credit-card',
  zh: '银行卡',
  category: 'commerce',
  tags: ['card', 'payment', 'bank', 'debit'],
  variants: ['plus', 'minus', 'check', 'x', 'lock', 'clock', 'alert', 'sync', 'cog'],
  // A card in front of another; on hover they fan apart as if being drawn out.
  svg: (u) => {
    const card = rr(0, 0, 20.4, 13.4, KR);
    return `<g data-n="b"><g filter="${u.sh}"><g filter="${u.hi}"><path d="${card}" fill="${u.upS}"/></g></g><path d="${card}" ${OL}/></g>
      <g data-n="fr"><g filter="${u.sh}"><g filter="${u.hi}"><path d="${card}" fill="${u.loS}"/></g></g><path d="${card}" ${OL}/>
        <path d="${rr(2.8, 3.6, 4.6, 3.6, 1)}" fill="#fff"/>
        <path d="${lines(2.8, 10, [7.4])}" class="ln" stroke="#fff" data-w="stroke"/></g>`;
  },
  target: (h) => ({ b: h ? [7.4, 2.2, 6] : [6.6, 3.3, 0], fr: h ? [3.4, 8.8, -3] : [4, 8.3, 0] }),
  draw(p, E) {
    at(E.b, { transform: `translate(${f(p.b[0])} ${f(p.b[1])}) rotate(${f(p.b[2])} 10.2 6.7)` });
    at(E.fr, { transform: `translate(${f(p.fr[0])} ${f(p.fr[1])}) rotate(${f(p.fr[2])} 10.2 6.7)` });
  }
};
})(),
(() => {

const LINK_RING = capsuleRing(15.6, 9.6, 2.8);

return {
  name: 'link',
  zh: '链接',
  category: 'interface',
  tags: ['chain', 'url', 'hyperlink', 'connect'],
  variants: ['plus', 'x', 'check', 'lock'],
  off: true,
  // Two links of a chain; hover draws them tighter.
  svg: (u) => `
    <g data-n="g">
      <g data-n="a"><g filter="${u.sh}"><g filter="${u.hi}"><path d="${LINK_RING}" fill-rule="evenodd" fill="${u.loS}"/></g></g><path d="${LINK_RING}" fill-rule="evenodd" ${OL}/></g>
      <g data-n="bb"><g filter="${u.sh}"><g filter="${u.hi}"><path d="${LINK_RING}" fill-rule="evenodd" fill="${u.upS}"/></g></g><path d="${LINK_RING}" fill-rule="evenodd" ${OL}/></g>
    </g>`,
  target: (h) => ({ gap: h ? 3.5 : 4.2, rot: h ? -40 : -45 }),
  draw(p, E) {
    at(E.g, { transform: `rotate(${f(p.rot)} 15.5 12.5)` });
    at(E.a, { transform: `translate(${f(15.5 - p.gap)} 12.5)` });
    at(E.bb, { transform: `translate(${f(15.5 + p.gap)} 12.5)` });
  }
};
})(),
(() => {

const HANDLE = rp([[1.6, 11.2], [14.4, 10.3], [14.4, 14.7], [1.6, 13.8]], [1.3, 0.4, 0.4, 1.3]);
const TUFT = 'M18 9.6H21.2C25 9.6 27.4 11.5 29.2 12.5C27.4 13.5 25 15.4 21.2 15.4H18Z';
const FERRULE = rr(13.4, 9.2, 5.6, 6.6, 0.9);

return {
  name: 'paintbrush',
  zh: '画笔',
  category: 'tools',
  tags: ['paint', 'brush', 'art', 'color', 'draw', '刷子'],
  // A paintbrush; on hover it sweeps sideways and leaves a stroke of paint.
  svg: (u) => `<path data-n="pt" fill="none" stroke-width="2.2" stroke-linecap="round" data-t="stroke:#2F6FE0"/>`
    + rig(u, 'p', [{ d: HANDLE, fill: u.loS }, { d: TUFT, fill: u.pure('#4389FF') }, { d: FERRULE, fill: u.upS }]),
  target: (h) => ({ x: h ? 1.2 : 0, ink: h ? 1 : 0 }),
  draw(p, E) {
    pose(E, 'p', 3, `translate(${f(p.x)} 0) rotate(135 15.5 12.5)`);
    const k = p.ink, d = `M5.2 23.6C${f(5.2 + 3 * k)} ${f(23.6 - 1.6 * k)} ${f(5.2 + 6 * k)} ${f(23.6 + 0.8 * k)} ${f(5.2 + 9 * k)} ${f(23.6 - 0.6 * k)}`;
    at(E.pt, { d, opacity: k > 0.05 ? 1 : 0 });
  }
};
})(),
(() => {

const MC = [18, 12.5];
const wave = (r) => {
  const p = (d) => [MC[0] + r * Math.cos(d * Math.PI / 180), MC[1] + r * Math.sin(d * Math.PI / 180)];
  const a = p(-32), b = p(32);
  return `M${f(a[0])} ${f(a[1])}A${f(r)} ${f(r)} 0 0 1 ${f(b[0])} ${f(b[1])}`;
};

return {
  name: 'megaphone',
  zh: '喇叭',
  category: 'communication',
  tags: ['announcement', 'broadcast', 'loudspeaker', 'marketing', 'promote', '公告'],
  off: true,
  // A megaphone with a grip; on hover it calls out and sound waves spread from its mouth.
  svg: (u) => {
    const horn = rp([[7.6, 9.4], [18, 4], [18, 21], [7.6, 15.6]], [1, 1.4, 1.4, 1]);
    const rear = rr(3.6, 8.2, 5.2, 8.6, 1.6), mouth = ellipse(18, 12.5, 2.4, 8.5);
    return `<path d="M11.8 16L13.2 21.6" fill="none" stroke-width="2.2" stroke-linecap="round" ${DEEPS}/>
      <g filter="${u.sh}"><g filter="${u.hi}"><path d="${horn}" fill="${u.loS}"/></g></g><path d="${horn}" ${OL}/>
      <g filter="${u.sh}"><g filter="${u.hi}"><path d="${rear}" fill="${u.upS}"/></g></g><path d="${rear}" ${OL}/>
      <g filter="${u.hi}"><path d="${mouth}" fill="${u.upS}"/></g><path d="${mouth}" ${OL}/>
      <path data-n="w1" fill="none" stroke-width="2.2" stroke-linecap="round" ${DEEPS}/>
      <path data-n="w2" fill="none" stroke-width="2.2" stroke-linecap="round" ${DEEPS}/>`;
  },
  target: (h) => ({ r: h ? [6, 8.8] : [5.2, 7.6], o: h ? 1 : 0 }),
  draw(p, E) {
    at(E.w1, { d: wave(p.r[0]), opacity: f(p.o) });
    at(E.w2, { d: wave(p.r[1]), opacity: f(Math.max(0, p.o * 1.6 - 0.6)) });
  }
};
})(),
(() => {

return {
  name: 'file-chart',
  zh: '报表文件',
  category: 'files',
  tags: ['report', 'chart', 'analytics', 'statistics', 'graph', '报表'],
  variants: FILE_BADGES,
  // A page carrying a bar chart whose bars move to new values on hover.
  svg: (u) => typedPage(u, '<path data-n="b1" fill="#fff" data-w="fill"/><path data-n="b2" fill="#fff" data-w="fill"/><path data-n="b3" fill="#fff" data-w="fill"/>'),
  target: (h) => ({ hgt: h ? [8, 4.6, 9.6] : [4.6, 9.2, 6.6] }),
  draw(p, E) {
    [9.4, 13.8, 18.2].forEach((x, i) => {
      const hh = p.hgt[i];
      at(E['b' + (i + 1)], { d: rp(R(x, 20.4 - hh, 3.4, hh), [1, 1, 0.4, 0.4]) });
    });
  }
};
})(),
(() => {

// Three stacked discs; each is a side wall under a lighter top face.
const X0 = 6.3, X1 = 24.7, RX = 9.2, RY = 2.8, HS = 5.4, TOP = [4.4, 9.8, 15.2];
const wall = (y) => `M${X0} ${f(y)}V${f(y + HS)}A${RX} ${RY} 0 0 0 ${X1} ${f(y + HS)}V${f(y)}Z`;

return {
  name: 'database',
  zh: '数据库',
  category: 'development',
  tags: ['data', 'storage', 'sql', 'db', 'records', '存储'],
  variants: ['plus', 'minus', 'check', 'x', 'search', 'lock', 'sync', 'cog', 'alert'],
  // A stack of three data discs; on hover the top disc lifts clear of the others.
  svg: (u) => [2, 1, 0].map((i) => `<g data-n="g${i}">
      <g filter="${u.sh}"><g filter="${u.hi}"><path d="${wall(TOP[i])}" fill="${u.loS}"/></g></g><path d="${wall(TOP[i])}" ${OL}/>
      <g filter="${u.hi}"><path d="${ellipse(15.5, TOP[i], RX, RY)}" fill="${u.upS}"/></g><path d="${ellipse(15.5, TOP[i], RX, RY)}" ${OL}/></g>`).join(''),
  target: (h) => ({ y: h ? [-3.6, 0.4, 0.4] : [0, 0, 0] }),
  draw(p, E) { p.y.forEach((y, i) => at(E['g' + i], { transform: `translate(0 ${f(y)})` })); }
};
})(),
(() => {

return {
  name: 'shield-check',
  zh: '盾牌',
  category: 'security',
  tags: ['shield', 'secure', 'protect', 'safe', 'verified'],
  // A shield with a lit half; it steps forward on hover.
  svg: (u) => {
    const sh = 'M15.5 1.4L24.2 4.8V11.4C24.2 17.2 20.6 21.6 15.5 23.8C10.4 21.6 6.8 17.2 6.8 11.4V4.8Z';
    return `<g data-n="g">
      <clipPath id="${u.id('half')}"><rect x="15.5" y="-2" width="16" height="30"/></clipPath>
      <g filter="${u.sh}"><g filter="${u.hi}"><path d="${sh}" fill="${u.loS}"/></g></g>
      <g clip-path="url(#${u.id('half')})"><g filter="${u.hi}"><path d="${sh}" fill="${u.upS}"/></g></g>
      <path d="${sh}" ${OL}/>
      <path d="M11.4 12.2L14.4 15.2L19.8 9.6" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ${DEEPS}/>
    </g>`;
  },
  target: (h) => ({ y: h ? -1 : 0, s: h ? 1.06 : 1 }),
  draw(p, E) { at(E.g, { transform: `translate(15.5 ${f(12.6 + p.y)}) scale(${f(p.s)}) translate(-15.5 -12.6)` }); }
};
})(),
  {
    name: '文件夹',
    svg: (u) => `
      <g filter="${u.sh}"><path data-n="back" fill="${u.lo(21)}"/></g>
      <path data-n="backO" ${OL}/>
      <g data-n="file"><path d="${rr(0, 0, 17, 9, 1)}" fill="#fff"/><path d="M5.5 2.3H11.5" ${LINE} stroke-width="1"/></g>
      <g filter="${u.hi}"><path data-n="front" fill="${u.up(18)}"/></g>
      <path data-n="frontO" ${OL}/>`,
    target: (h) => ({
      back: h ? [[4, 3], [11.2, 3], [14.2, 6], [27, 6], [27.6, 23], [4.6, 23]] : [[4, 2], [11.2, 2], [14.2, 5], [27, 5], [27, 23], [4, 23]],
      fx: h ? 7.9 : 7,
      front: h ? [[6.8, 13], [29.3, 13], [27.6, 23], [5.4, 23]] : [[4, 5], [27, 5], [27, 23], [4, 23]],
      fr: h ? 1.8 : KR
    }),
    draw(p, E) {
      const b = rp(p.back, FOLDER_BACK_R), fr = rp(p.front, p.fr);
      at(E.back, { d: b }); at(E.backO, { d: b });
      at(E.file, { transform: `translate(${f(p.fx)} 9)` });
      at(E.front, { d: fr }); at(E.frontO, { d: fr });
    }
  },
  {
    name: '邮件',
    svg: (u) => {
      const T = MAIL_T;
      const body = rr(4, T, 23, 18.4, KR);
      const pocket = rp([[4, T + 3.8], [15.5, T + 10.4], [27, T + 3.8], [27, T + 18.4], [4, T + 18.4]], [0.6, 2.4, 0.6, KR, KR]);
      const B = T + 18.4;
      return `
      <g filter="${u.sh}"><path d="${body}" fill="${u.lo(18.4)}"/></g>
      <path d="${body}" ${OL}/>
      <g data-n="inG"><path data-n="inF" fill="${u.loS}"/><path data-n="inO" ${OL}/></g>
      <g data-n="letter"><path d="${rr(7, 0, 17, 12, CR)}" fill="#fff"/><path d="${lines(9.8, 3.6, [7])}" ${ACC}/><path d="${lines(9.8, 6.8, [11.4])}" ${LINE}/></g>
      <path d="${pocket}" fill="${u.up(15.6)}"/>
      <g data-n="outG"><g filter="${u.hi}"><path data-n="outF" fill="${u.loS}"/></g><path data-n="outO" ${OL}/></g>`;
    },
    target: (h) => ({ o: h ? 1 : 0 }),
    draw(p, E) {
      // The flap is the back sheet folded over, so it takes the back's mid tone; the pocket
      // is the lighter front. The flap shares the body's top corners and its lower edges lie on the pocket's V;
      // turning it scales its height about the top edge from 1 to -0.7. The letter rises after.
      const T = MAIL_T;
      const o = Math.max(0, Math.min(1, p.o));
      const k = 1 + (-0.7 - 1) * Math.min(1, o / 0.55);
      const rise = Math.max(0, Math.min(1, (o - 0.35) / 0.65));
      // Closed it is a pentagon sharing the body's top corners. Open, its fold drops to where
      // the body's sides turn straight and its base corners square off, so the body's side
      // outline runs straight up into the flap's and the body's rounded top hides behind it.
      let d;
      if (k >= 0) {
        d = rp([[4, T], [27, T], [27, T + 3.8 * k], [15.5, T + 10.4 * k], [4, T + 3.8 * k]], [KR, KR, 0.6, 2.4, 0.6], true);
      } else {
        const q = Math.min(1, -k / 0.3), fold = T + KR * q, cr = KR * (1 - q);
        d = rp([[4, fold], [27, fold], [27, T], [15.5, T + 10.4 * k], [4, T]], [cr, cr, 0.8, 2.4, 0.8], true);
      }
      const down = k >= 0;
      at(E.outF, { d }); at(E.outO, { d }); at(E.outG, { opacity: down ? 1 : 0 });
      at(E.inF, { d }); at(E.inO, { d }); at(E.inG, { opacity: down ? 0 : 1 });
      at(E.letter, { transform: `translate(0 ${f(T + 5 + (-6.5) * rise)})` });
    }
  },
  {
    name: '下载',
    // Back: the disc. Front: a lighter lower segment. The arrow follows the front down
    // on hover and always stays clear of it.
    svg: (u) => {
      const r = 11.5;
      return `
      <g filter="${u.sh}"><g filter="${u.hi}"><path d="${circ(15.5, 12.5, r)}" fill="${u.loS}"/></g></g>
      <path d="${circ(15.5, 12.5, r)}" ${OL}/>
      <path data-n="arrow" fill="none" stroke="#fff" data-w="stroke" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <g filter="${u.hi}"><path data-n="seg" fill="${u.upS}"/></g>
      <path data-n="segO" ${OL}/>`;
    },
    target: (h) => ({ tip: h ? 13.4 : 12.4, chord: h ? 16.6 : 15.6 }),
    draw(p, E) {
      const t = p.tip;
      at(E.arrow, { d: `M15.5 ${f(t - 9.4)}V${f(t)}M11.9 ${f(t - 3.6)}L15.5 ${f(t)}L19.1 ${f(t - 3.6)}` });
      const disc = [15.5, 12.5, 11.5];
      const seg = frontPiece(disc, disc, p.chord, 2);
      at(E.seg, { d: seg }); at(E.segO, { d: seg });
    }
  },
  {
    name: '日历',
    svg: (u) => {
      const body = rr(5.2, 3.4, 20.6, 19.4, KR);
      const sheet = rp(R(8.2, 9, 14.6, 10.8), [0, 0, CR, CR]);
      const head = rp(R(5.2, 3.4, 20.6, 5.6), [KR, KR, 0, 0]);
      const ring = rr(10.4, 1.6, 1.8, 3.8, 0.9) + rr(18.8, 1.6, 1.8, 3.8, 0.9);
      return `
      <g filter="${u.sh}"><path d="${body}" fill="${u.loS}"/></g>
      <path d="${sheet}" fill="#fff"/>
      <text x="15.5" y="17.4" text-anchor="middle" font-size="8.4" font-weight="700" data-t="fill:#81B0FF">${tomorrow.getDate()}</text>
      <g data-n="sheet"><path d="${sheet}" fill="#fff"/>
        <text x="15.5" y="17.4" text-anchor="middle" font-size="8.4" font-weight="700" data-t="fill:#4389FF">${today.getDate()}</text>
        <path data-n="shade" d="${sheet}" data-t="fill:#4389FF" opacity="0"/></g>
      <path d="${body}" ${OL}/>
      <g filter="${u.hi}"><path d="${head}" fill="${u.upS}"/></g>
      <path d="${head}" ${OL}/>
      <g data-n="rings"><path d="${ring}" fill="#fff"/><path d="${ring}" ${OL}/></g>`;
    },
    target: (h) => ({ o: h ? 1 : 0, rings: h ? -0.6 : 0 }),
    draw(p, E) {
      // Today's page turns up under the header: it foreshortens toward its top edge and
      // darkens as it faces away, uncovering tomorrow.
      const o = Math.max(0, Math.min(1, p.o));
      const sy = Math.cos(o * Math.PI / 2);
      at(E.sheet, { transform: `translate(0 9) scale(1 ${f(Math.max(0.001, sy))}) translate(0 -9)`, opacity: o > 0.985 ? 0 : 1 });
      at(E.shade, { opacity: f(0.45 * Math.sin(o * Math.PI / 2)) });
      at(E.rings, { transform: `translate(0 ${f(p.rings)})` });
    }
  }
];

ICONS.push({
  name: 'banknote',
  zh: '纸币',
  category: 'commerce',
  tags: ['money', 'cash', 'bill', 'payment', 'currency', '现金', '钞票'],
  variants: ['plus', 'minus', 'check', 'x', 'up', 'down', 'right', 'sync', 'clock'],
  // Two banknotes, one on the other; on hover they fan apart as if being counted.
  svg: (u) => {
    const note = rr(0, 0, 20.6, 12.6, KR);
    return `<g data-n="b"><g filter="${u.sh}"><g filter="${u.hi}"><path d="${note}" fill="${u.upS}"/></g></g><path d="${note}" ${OL}/></g>
      <g data-n="fr"><g filter="${u.sh}"><g filter="${u.hi}"><path d="${note}" fill="${u.loS}"/></g></g><path d="${note}" ${OL}/>
        <path d="${circ(10.3, 6.3, 3.2)}" fill="#fff"/>
        <path d="${circ(4, 6.3, 1.25) + circ(16.6, 6.3, 1.25)}" fill="#fff" data-w="fill"/></g>`;
  },
  target: (h) => ({ b: h ? [7.2, 2.6, 7] : [6.4, 3.6, 0], fr: h ? [3.6, 9.2, -4] : [4, 8.4, 0] }),
  draw(p, E) {
    at(E.b, { transform: `translate(${f(p.b[0])} ${f(p.b[1])}) rotate(${f(p.b[2])} 10.3 6.3)` });
    at(E.fr, { transform: `translate(${f(p.fr[0])} ${f(p.fr[1])}) rotate(${f(p.fr[2])} 10.3 6.3)` });
  }
});
{
const cardBack=(u,d,fill)=>`<g filter="${u.sh}"><g filter="${u.hi}"><path d="${d}" fill="${fill}"/></g></g><path d="${d}" ${OL}/>`;
// The slip: straight sides, five torn teeth along the bottom.
const slip = (() => {
  const l = 8.4, r = 22.6, w = (r - l) / 5, pts = [[l, -1], [r, -1], [r, 19.6]];
  for (let i = 0; i < 5; i++) pts.push([r - w * (i + 0.5), 21.2], [r - w * (i + 1), 19.6]);
  pts.pop(); pts.push([l, 19.6]);
  return rp(pts, [0, 0, 0.3, ...pts.slice(3, -1).map(() => 0.4), 0.3]);
})();

ICONS.push({
  name: 'receipt',
  zh: '小票',
  category: 'commerce',
  tags: ['bill', 'purchase', 'order', 'transaction', 'expense', '收据', '账单'],
  variants: ['plus', 'check', 'x', 'search', 'down', 'right', 'clock', 'alert', 'sparkle'],
  // A receipt coming out of a printer slot; on hover it prints longer.
  svg: (u) => `<clipPath id="${u.id('out')}"><rect x="0" y="4" width="31" height="24"/></clipPath>
    <g clip-path="url(#${u.id('out')})"><g data-n="slip"><g filter="${u.sh}"><g filter="${u.hi}"><path d="${slip}" fill="${u.loS}"/></g></g><path d="${slip}" ${OL}/>
      <path d="${lines(10.8, 9.6, [9.4, 6])}" class="ln" stroke="#fff" data-w="stroke"/></g></g>
    ${cardBack(u, rr(5.2, 1.4, 20.6, 4.6, 2.3), u.upS)}`,
  target: (h) => ({ y: h ? 2.6 : 0 }),
  draw(p, E) { at(E.slip, { transform: `translate(0 ${f(p.y)})` }); }
});

}

{
function arcArrow(a0, a1, r, head = 2.5, len = 3) {
  const rad = (d) => d * Math.PI / 180;
  const pt = (a) => [r * Math.cos(rad(a)), r * Math.sin(rad(a))];
  const s = pt(a0), e = pt(a1);
  const t = [-Math.sin(rad(a1)), Math.cos(rad(a1))], n = [Math.cos(rad(a1)), Math.sin(rad(a1))];
  const tip = [e[0] + t[0] * len, e[1] + t[1] * len];
  const hd = rp([[e[0] + n[0] * head, e[1] + n[1] * head], tip, [e[0] - n[0] * head, e[1] - n[1] * head]], 0.5);
  return { arc: `M${f(s[0])} ${f(s[1])}A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${f(e[0])} ${f(e[1])}`, head: hd };
}
/**
 * A straight arrow from (x1, y1) to (x2, y2): a shaft ending under a solid head.
 * Returns { shaft, head }: stroke the shaft at 2.2 with round caps, fill the head.
 */
const disc=(u)=>`<g filter="${u.sh}"><g filter="${u.hi}"><path d="${circ(15.5,12.5,11.5)}" fill="${u.loS}"/></g></g><path d="${circ(15.5,12.5,11.5)}" ${OL}/><g filter="${u.hi}"><path d="${circ(15.5,12.5,8.4)}" fill="${u.upS}"/></g><path d="${circ(15.5,12.5,8.4)}" ${OL}/>`;
const STROKE='fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" data-t="stroke:#2F6FE0"',DEEP='data-t="fill:#2F6FE0"';
const place=(a)=>`translate(15.5 12.5) rotate(${f(a)})`,swell=(x)=>Math.sin(Math.PI*x);
const ring = (r) => arcArrow(40, 310, r, 2.6, 3.2), ARC = ring(4.6);

ICONS.push({
  name: 'rotate-cw',
  zh: '顺时针旋转',
  category: 'arrows',
  tags: ['rotate', 'clockwise', 'redo', 'turn', 'refresh', '旋转'],
  // A disc with a clockwise circular arrow that spins a full turn on hover, opening
  // out a little as it goes.
  svg: (u) => disc(u) + `<g data-n="arr"><path data-n="aS" d="${ARC.arc}" ${STROKE}/><path data-n="aH" d="${ARC.head}" ${DEEP}/></g>`,
  target: (h) => ({ rot: h ? 360 : 0 }),
  draw(p, E) {
    const a = ring(4.6 + 0.6 * swell(p.rot / 360));
    at(E.aS, { d: a.arc }); at(E.aH, { d: a.head });
    at(E.arr, { transform: place(p.rot) });
  }
});

}
