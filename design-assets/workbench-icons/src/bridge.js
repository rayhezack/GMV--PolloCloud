// React integration; the Kubai engine above remains unchanged.
let nextIconId = 0;
runtime.palette = { colors: [], edges: [], deepMarks: true };
// Lift the body much more than the edge so the glass navigation stays light.
const glassTone = (base) => ({
  colors: [soften(base, 0.84)],
  edges: [soften(base, 0.38)],
});
const idleTone = glassTone('#61718A');
const activeTone = glassTone('#533AFD');

export function mountWorkbenchIcon(name, host, active = false) {
  const icon = ICONS.find(item => item.name === name);
  if (!icon) throw new Error(`Unknown workbench icon: ${name}`);
  const id = nextIconId++;
  function setTone(selected) {
    const tone = selected ? activeTone : idleTone;
    runtime.palette.colors[id] = tone.colors[0];
    runtime.palette.edges[id] = tone.edges[0];
  }
  setTone(active);
  const instance = mountIcon(icon, id, host);
  return {
    setActive(selected) { setTone(selected); go(instance); },
    setHover(hovered) { instance.hover = hovered ? 1 : 0; go(instance); },
    destroy() {
      cancelAnimationFrame(instance.raf);
      delete runtime.palette.colors[id];
      delete runtime.palette.edges[id];
      host.replaceChildren();
    },
  };
}
