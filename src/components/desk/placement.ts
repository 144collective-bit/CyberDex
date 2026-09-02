import type { ModuleInstance, ModulePosition, ModuleSize } from '../../core/modules/types';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Where a newly added module should land: in the part of the canvas the user is
 * actually looking at, stepped diagonally until it stops covering something.
 */
export function findFreePosition(
  modules: ModuleInstance[],
  preferred: ModulePosition,
  size: ModuleSize,
  step = 28,
  maxTries = 60,
): ModulePosition {
  const existing: Rect[] = modules.map((m) => ({
    x: m.position.x,
    y: m.position.y,
    width: m.size.width,
    height: m.collapsed ? 24 : m.size.height,
  }));

  for (let attempt = 0; attempt < maxTries; attempt += 1) {
    const candidate: Rect = {
      x: Math.max(0, preferred.x + attempt * step),
      y: Math.max(0, preferred.y + attempt * step),
      width: size.width,
      height: size.height,
    };
    if (!existing.some((rect) => overlaps(rect, candidate))) {
      return { x: candidate.x, y: candidate.y };
    }
  }
  return { x: Math.max(0, preferred.x), y: Math.max(0, preferred.y) };
}

/** Top-left of the desk's current scroll viewport, in canvas coordinates. */
export function viewportOrigin(): ModulePosition {
  if (typeof document === 'undefined') return { x: 40, y: 40 };
  const desk = document.querySelector('.desk');
  if (!desk) return { x: 40, y: 40 };
  return { x: Math.round(desk.scrollLeft) + 40, y: Math.round(desk.scrollTop) + 40 };
}
