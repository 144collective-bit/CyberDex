import type { ModuleInstance } from '../../core/modules/types';
import { HEADER_HEIGHT } from './geometry';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Guide {
  orientation: 'v' | 'h';
  /** Canvas coordinate of the line. */
  position: number;
  /** Extent of the line, so it spans only the modules it relates. */
  from: number;
  to: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: Guide[];
  /** True when a guide (not the grid) decided the position. */
  aligned: boolean;
}

export const SNAP_THRESHOLD = 7;

export function moduleRect(module: ModuleInstance): Rect {
  return {
    x: module.position.x,
    y: module.position.y,
    width: module.size.width,
    height: module.collapsed ? HEADER_HEIGHT : module.size.height,
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function snapToGrid(value: number, grid: number, enabled: boolean): number {
  if (!enabled || grid <= 1) return Math.round(value);
  return Math.round(value / grid) * grid;
}

/**
 * Fraction of a module's width/height treated as its edge, where a drop means
 * "put it here" rather than "swap with this".
 */
export const SWAP_EDGE_INSET = 0.2;

/**
 * Which module, if any, this drag would swap places with.
 *
 * The dragged module's centre must land in the target's middle band — the outer
 * fifth on each side is a normal drop zone, so nudging a module up against its
 * neighbour never turns into an accidental swap.
 */
export function findSwapTarget(
  dragged: Rect,
  others: { id: string; rect: Rect; locked?: boolean }[],
  inset = SWAP_EDGE_INSET,
): string | null {
  const cx = dragged.x + dragged.width / 2;
  const cy = dragged.y + dragged.height / 2;
  // Later modules paint on top, so prefer the last match under the cursor.
  for (let i = others.length - 1; i >= 0; i -= 1) {
    const candidate = others[i]!;
    if (candidate.locked) continue;
    const { rect } = candidate;
    const insetX = rect.width * inset;
    const insetY = rect.height * inset;
    if (
      cx >= rect.x + insetX &&
      cx <= rect.x + rect.width - insetX &&
      cy >= rect.y + insetY &&
      cy <= rect.y + rect.height - insetY
    ) {
      return candidate.id;
    }
  }
  return null;
}

interface Candidate {
  value: number;
  distance: number;
  guide: Guide;
}

function bestCandidate(candidates: Candidate[], threshold: number): Candidate | null {
  const viable = candidates.filter((candidate) => candidate.distance <= threshold);
  if (!viable.length) return null;
  return viable.reduce((best, candidate) => (candidate.distance < best.distance ? candidate : best));
}

/**
 * Magnetic alignment against neighbouring modules.
 *
 * Considers matching left edges, right edges, centres, and edge-to-edge
 * adjacency on both axes. Falls back to the grid when nothing is within reach,
 * so a drag in open space still lands predictably.
 */
export function computeSnap(
  dragged: Rect,
  others: Rect[],
  options: { grid: number; snapToGrid: boolean; threshold?: number },
): SnapResult {
  const threshold = options.threshold ?? SNAP_THRESHOLD;
  const right = dragged.x + dragged.width;
  const bottom = dragged.y + dragged.height;
  const centreX = dragged.x + dragged.width / 2;
  const centreY = dragged.y + dragged.height / 2;

  const xCandidates: Candidate[] = [];
  const yCandidates: Candidate[] = [];

  for (const other of others) {
    const oRight = other.x + other.width;
    const oBottom = other.y + other.height;
    const oCentreX = other.x + other.width / 2;
    const oCentreY = other.y + other.height / 2;
    const spanY = { from: Math.min(dragged.y, other.y), to: Math.max(bottom, oBottom) };
    const spanX = { from: Math.min(dragged.x, other.x), to: Math.max(right, oRight) };

    const pushX = (value: number, line: number, distance: number) =>
      xCandidates.push({ value, distance, guide: { orientation: 'v', position: line, ...spanY } });
    const pushY = (value: number, line: number, distance: number) =>
      yCandidates.push({ value, distance, guide: { orientation: 'h', position: line, ...spanX } });

    pushX(other.x, other.x, Math.abs(dragged.x - other.x)); // left ↔ left
    pushX(oRight - dragged.width, oRight, Math.abs(right - oRight)); // right ↔ right
    pushX(oCentreX - dragged.width / 2, oCentreX, Math.abs(centreX - oCentreX)); // centre ↔ centre
    pushX(oRight, oRight, Math.abs(dragged.x - oRight)); // butt up to its right edge
    pushX(other.x - dragged.width, other.x, Math.abs(right - other.x)); // butt up to its left edge

    pushY(other.y, other.y, Math.abs(dragged.y - other.y));
    pushY(oBottom - dragged.height, oBottom, Math.abs(bottom - oBottom));
    pushY(oCentreY - dragged.height / 2, oCentreY, Math.abs(centreY - oCentreY));
    pushY(oBottom, oBottom, Math.abs(dragged.y - oBottom));
    pushY(other.y - dragged.height, other.y, Math.abs(bottom - other.y));
  }

  const bestX = bestCandidate(xCandidates, threshold);
  const bestY = bestCandidate(yCandidates, threshold);
  const guides: Guide[] = [];
  if (bestX) guides.push(bestX.guide);
  if (bestY) guides.push(bestY.guide);

  return {
    x: Math.max(0, bestX ? bestX.value : snapToGrid(dragged.x, options.grid, options.snapToGrid)),
    y: Math.max(0, bestY ? bestY.value : snapToGrid(dragged.y, options.grid, options.snapToGrid)),
    guides,
    aligned: Boolean(bestX || bestY),
  };
}
