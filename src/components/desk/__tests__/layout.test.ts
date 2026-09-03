import { describe, expect, it } from 'vitest';
import { computeSnap, findSwapTarget, moduleRect, rectsOverlap, snapToGrid } from '../layout';
import type { Rect } from '../layout';
import { createModuleInstance } from '../../../core/modules/registry';
import { MODULE_TYPES } from '../../../modules/definitions';

const rect = (x: number, y: number, width = 200, height = 150): Rect => ({ x, y, width, height });

describe('grid snapping', () => {
  it('rounds to the grid when enabled and to whole pixels when not', () => {
    expect(snapToGrid(187, 20, true)).toBe(180);
    expect(snapToGrid(193, 20, true)).toBe(200);
    expect(snapToGrid(187.6, 20, false)).toBe(188);
  });
});

describe('moduleRect', () => {
  it('uses header height for a collapsed module', () => {
    const module = createModuleInstance(MODULE_TYPES.gas, { position: { x: 10, y: 20 } });
    expect(moduleRect(module).height).toBe(module.size.height);
    expect(moduleRect({ ...module, collapsed: true }).height).toBe(24);
  });
});

describe('findSwapTarget', () => {
  const others = [
    { id: 'a', rect: rect(0, 0) },
    { id: 'b', rect: rect(400, 0) },
  ];

  it('picks the module whose middle the dragged centre lands in', () => {
    // Dragged rect centred at (500, 75) → the middle of b (400–600, 0–150).
    expect(findSwapTarget(rect(400, 0), others)).toBe('b');
  });

  it('treats the outer fifth of a module as a drop zone, not a swap', () => {
    // Centre at (420, 75): inside b, but within its left edge band.
    expect(findSwapTarget(rect(320, 0), others)).toBeNull();
  });

  it('returns null when the drop lands in a gap', () => {
    expect(findSwapTarget(rect(250, 300), others)).toBeNull();
  });

  it('never targets a locked module', () => {
    const locked = [{ id: 'a', rect: rect(0, 0), locked: true }];
    expect(findSwapTarget(rect(-50, -25), locked)).toBeNull();
  });

  it('prefers the module painted on top when they overlap', () => {
    const stacked = [
      { id: 'under', rect: rect(0, 0, 400, 400) },
      { id: 'over', rect: rect(50, 50, 200, 200) },
    ];
    // Centre at (150, 150) — the middle of both, so the topmost wins.
    expect(findSwapTarget(rect(120, 120, 60, 60), stacked)).toBe('over');
  });
});

describe('computeSnap', () => {
  const options = { grid: 20, snapToGrid: true };

  it('aligns left edges within the threshold and reports a guide', () => {
    const result = computeSnap(rect(304, 500), [rect(300, 0)], options);
    expect(result.x).toBe(300);
    expect(result.aligned).toBe(true);
    expect(result.guides.some((guide) => guide.orientation === 'v' && guide.position === 300)).toBe(true);
  });

  it('aligns centres on both axes at once', () => {
    const neighbour = rect(100, 100, 200, 200);
    // Neighbour centre is (200, 200); a 100×100 rect centres there at (150, 150).
    const result = computeSnap(rect(153, 147, 100, 100), [neighbour], options);
    expect(result.x).toBe(150);
    expect(result.y).toBe(150);
    expect(result.guides).toHaveLength(2);
  });

  it('butts a module up flush against a neighbour edge', () => {
    // Neighbour spans 300–500; dropping just past it snaps to 500.
    const result = computeSnap(rect(503, 0), [rect(300, 0)], options);
    expect(result.x).toBe(500);
  });

  it('falls back to the grid when nothing is near', () => {
    const result = computeSnap(rect(187, 213), [rect(1000, 1000)], options);
    expect(result).toMatchObject({ x: 180, y: 220, aligned: false });
    expect(result.guides).toHaveLength(0);
  });

  it('respects free positioning when grid snap is off', () => {
    const result = computeSnap(rect(187, 213), [], { grid: 20, snapToGrid: false });
    expect(result).toMatchObject({ x: 187, y: 213, aligned: false });
  });

  it('never places a module off the canvas', () => {
    const result = computeSnap(rect(-80, -40), [], options);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('chooses the nearest of several competing alignments', () => {
    const result = computeSnap(rect(302, 0), [rect(300, 0), rect(306, 400)], options);
    expect(result.x).toBe(300);
  });
});

describe('rectsOverlap', () => {
  it('detects overlap and separation', () => {
    expect(rectsOverlap(rect(0, 0), rect(100, 100))).toBe(true);
    expect(rectsOverlap(rect(0, 0), rect(300, 0))).toBe(false);
    // Touching edges are not an overlap.
    expect(rectsOverlap(rect(0, 0), rect(200, 0))).toBe(false);
  });
});
