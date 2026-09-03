import { describe, expect, it } from 'vitest';
import type { ModuleInstance } from '../../../core/modules/types';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  contentBounds,
  fitZoom,
  nextZoom,
  scrollForZoomAtPoint,
  scrollToRect,
  visibleRect,
} from '../zoom';

function module(
  id: string,
  x: number,
  y: number,
  width = 200,
  height = 160,
  extra: Partial<ModuleInstance> = {},
): ModuleInstance {
  return {
    id,
    type: 'price',
    version: '1.0.0',
    name: id.toUpperCase(),
    position: { x, y },
    size: { width, height },
    configuration: {},
    locked: false,
    collapsed: false,
    pinned: false,
    ...extra,
  };
}

describe('clampZoom', () => {
  it('holds the zoom inside its range', () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(1)).toBe(1);
  });

  it('falls back to 1 rather than propagating a bad number', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('nextZoom', () => {
  it('steps to the neighbouring stop', () => {
    expect(nextZoom(1, 1)).toBe(1.25);
    expect(nextZoom(1, -1)).toBe(0.8);
  });

  it('stops at each end instead of wrapping', () => {
    expect(nextZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(nextZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });

  it('snaps a continuous zoom back onto the ladder', () => {
    // A fit-to-view zoom is an arbitrary number; pressing + should land on a
    // stop rather than adding a fixed increment to the odd value.
    expect(nextZoom(0.73, 1)).toBe(0.8);
    expect(nextZoom(0.73, -1)).toBe(0.65);
  });
});

describe('contentBounds', () => {
  it('is null for an empty deck', () => {
    expect(contentBounds([])).toBeNull();
  });

  it('spans every module', () => {
    const bounds = contentBounds([module('a', 100, 100), module('b', 500, 300, 300, 200)]);
    expect(bounds).toEqual({ x: 100, y: 100, width: 700, height: 400 });
  });

  it('measures a collapsed module by its header, not its stored height', () => {
    const bounds = contentBounds([module('a', 0, 0, 200, 400, { collapsed: true })]);
    expect(bounds?.height).toBe(24);
  });
});

describe('fitZoom', () => {
  it('shrinks until the content fits, on the tighter axis', () => {
    const zoom = fitZoom({ x: 0, y: 0, width: 2000, height: 400 }, { width: 1000, height: 800 }, 0);
    expect(zoom).toBeCloseTo(0.5);
  });

  it('never magnifies a small deck', () => {
    expect(fitZoom({ x: 0, y: 0, width: 100, height: 100 }, { width: 1400, height: 900 })).toBe(1);
  });

  it('will not go below the minimum zoom for an enormous deck', () => {
    expect(fitZoom({ x: 0, y: 0, width: 90_000, height: 90_000 }, { width: 800, height: 600 })).toBe(
      ZOOM_MIN,
    );
  });
});

describe('scrollToRect', () => {
  it('centres the rect in the viewport', () => {
    const scroll = scrollToRect(
      { x: 1000, y: 1000, width: 200, height: 200 },
      { width: 800, height: 600 },
      1,
      { width: 4000, height: 2600 },
    );
    expect(scroll).toEqual({ scrollLeft: 700, scrollTop: 800 });
  });

  it('accounts for the zoom', () => {
    const scroll = scrollToRect(
      { x: 1000, y: 1000, width: 200, height: 200 },
      { width: 800, height: 600 },
      0.5,
      { width: 4000, height: 2600 },
    );
    expect(scroll).toEqual({ scrollLeft: 150, scrollTop: 250 });
  });

  it('never scrolls past either end of the canvas', () => {
    const canvas = { width: 4000, height: 2600 };
    const viewport = { width: 800, height: 600 };
    expect(scrollToRect({ x: 0, y: 0, width: 10, height: 10 }, viewport, 1, canvas)).toEqual({
      scrollLeft: 0,
      scrollTop: 0,
    });
    expect(scrollToRect({ x: 3990, y: 2590, width: 10, height: 10 }, viewport, 1, canvas)).toEqual({
      scrollLeft: 3200,
      scrollTop: 2000,
    });
  });
});

describe('scrollForZoomAtPoint', () => {
  const canvas = { width: 4000, height: 2600 };

  it('keeps the canvas point under the cursor fixed', () => {
    const viewport = { width: 800, height: 600, scrollLeft: 400, scrollTop: 200 };
    const anchor = { x: 300, y: 150 };
    // The canvas point currently under the cursor.
    const canvasX = (viewport.scrollLeft + anchor.x) / 1;
    const scroll = scrollForZoomAtPoint(viewport, anchor, 1, 2, canvas);
    // After the zoom, that same canvas point must still sit at the anchor.
    expect((scroll.scrollLeft + anchor.x) / 2).toBeCloseTo(canvasX);
  });

  it('holds the point when zooming out too', () => {
    const viewport = { width: 800, height: 600, scrollLeft: 1200, scrollTop: 900 };
    const anchor = { x: 500, y: 400 };
    const canvasY = (viewport.scrollTop + anchor.y) / 1;
    const scroll = scrollForZoomAtPoint(viewport, anchor, 1, 0.5, canvas);
    expect((scroll.scrollTop + anchor.y) / 0.5).toBeCloseTo(canvasY);
  });

  it('clamps rather than producing a negative scroll near the origin', () => {
    const viewport = { width: 800, height: 600, scrollLeft: 0, scrollTop: 0 };
    const scroll = scrollForZoomAtPoint(viewport, { x: 10, y: 10 }, 1, 0.5, canvas);
    expect(scroll.scrollLeft).toBe(0);
    expect(scroll.scrollTop).toBe(0);
  });
});

describe('visibleRect', () => {
  it('reports the on-screen area in canvas coordinates', () => {
    expect(visibleRect({ width: 800, height: 600, scrollLeft: 400, scrollTop: 200 }, 0.5)).toEqual({
      x: 800,
      y: 400,
      width: 1600,
      height: 1200,
    });
  });
});
