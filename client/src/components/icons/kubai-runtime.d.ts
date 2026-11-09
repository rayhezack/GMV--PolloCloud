export function mountWorkbenchIcon(name: string, host: HTMLElement, active?: boolean): {
  setActive(active: boolean): void;
  setHover(hovered: boolean): void;
  destroy(): void;
};
