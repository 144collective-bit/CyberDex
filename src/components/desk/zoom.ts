import type { ModuleInstance } from '../../core/modules/types';
import { moduleHeight } from './geometry';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
}

export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 2;

/**
 * Discrete stops rather than free scaling.
 *
 * A deck read at 63% and a deck read at 67% are the same deck, and letting the
 * value drift means the zoom control can never say anything as useful as
 * "100%". Wheel and buttons both land on a stop; only fit-to-view computes a
 * continuous value, because there the answer is dictated by the content.
 */
export const ZOOM_STOPS = [0.35, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2] as const;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** The next stop above (`+1`) or below (`-1`) the current zoom. */
export function nextZoom(current: number, direction: 1 | -1): number {
  const zoom = clampZoom(current);
  if (direction > 0) return ZOOM_STOPS.find((stop) => stop > zoom + 1e-6) ?? ZOOM_MAX;
  return [...ZOOM_STOPS].reverse().find((stop) => stop < zoom - 1e-6) ?? ZOOM_MIN;
}

/** Bounding box of every module on the deck, in canvas coordinates. */
export function contentBounds(modules: ModuleInstance[]): Rect | null {
  if (modules.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const module of modules) {
    minX = Math.min(minX, module.position.x);
    minY = Math.min(minY, module.position.y);
    maxX = Math.max(maxX, module.position.x + module.size.width);
    maxY = Math.max(maxY, module.position.y + moduleHeight(module));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The zoom at which `bounds` fits inside `viewport` with `padding` to spare.
 *
 * Never zooms past 1: a deck of three modules should sit at its natural size in
 * the middle of the screen, not be blown up until the text looks broken.
 */
export function fitZoom(bounds: Rect, viewport: { width: number; height: number }, padding = 48): number {
  const usableW = Math.max(1, viewport.width - padding * 2);
  const usableH = Math.max(1, viewport.height - padding * 2);
  const scale = Math.min(usableW / Math.max(1, bounds.width), usableH / Math.max(1, bounds.height));
  return clampZoom(Math.min(1, scale));
}

/**
 * Scroll offsets that put `rect` (canvas coordinates) in the middle of the
 * viewport at `zoom`, clamped so we never scroll past the canvas.
 */
export function scrollToRect(
  rect: Rect,
  viewport: { width: number; height: number },
  zoom: number,
  canvas: { width: number; height: number },
): { scrollLeft: number; scrollTop: number } {
  const centreX = (rect.x + rect.width / 2) * zoom;
  const centreY = (rect.y + rect.height / 2) * zoom;
  const maxLeft = Math.max(0, canvas.width * zoom - viewport.width);
  const maxTop = Math.max(0, canvas.height * zoom - viewport.height);
  return {
    scrollLeft: Math.min(maxLeft, Math.max(0, centreX - viewport.width / 2)),
    scrollTop: Math.min(maxTop, Math.max(0, centreY - viewport.height / 2)),
  };
}

/**
 * Scroll offsets that keep the canvas point currently under `anchor` under it
 * after a zoom change — the difference between zooming and teleporting.
 *
 * `anchor` is measured from the top-left of the viewport, not the page.
 */
export function scrollForZoomAtPoint(
  viewport: Viewport,
  anchor: { x: number; y: number },
  fromZoom: number,
  toZoom: number,
  canvas: { width: number; height: number },
): { scrollLeft: number; scrollTop: number } {
  const canvasX = (viewport.scrollLeft + anchor.x) / fromZoom;
  const canvasY = (viewport.scrollTop + anchor.y) / fromZoom;
  const maxLeft = Math.max(0, canvas.width * toZoom - viewport.width);
  const maxTop = Math.max(0, canvas.height * toZoom - viewport.height);
  return {
    scrollLeft: Math.min(maxLeft, Math.max(0, canvasX * toZoom - anchor.x)),
    scrollTop: Math.min(maxTop, Math.max(0, canvasY * toZoom - anchor.y)),
  };
}

/** The part of the canvas currently on screen, in canvas coordinates. */
export function visibleRect(viewport: Viewport, zoom: number): Rect {
  return {
    x: viewport.scrollLeft / zoom,
    y: viewport.scrollTop / zoom,
    width: viewport.width / zoom,
    height: viewport.height / zoom,
  };
}
