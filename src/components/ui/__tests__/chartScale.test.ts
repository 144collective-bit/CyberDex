import { describe, expect, it } from 'vitest';
import type { Candle } from '../../../core/types';
import {
  decimalsForStep,
  formatAxisPrice,
  formatAxisTime,
  movingAverage,
  niceStep,
  niceTicks,
  priceExtent,
  tickIndices,
} from '../chartScale';

function candle(t: number, o: number, h: number, l: number, c: number, v = 1): Candle {
  return { t, o, h, l, c, v };
}

describe('niceStep', () => {
  it('snaps to 1, 2, 2.5 or 5 times a power of ten', () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(1.7)).toBe(2);
    expect(niceStep(2.2)).toBe(2.5);
    expect(niceStep(4)).toBe(5);
    expect(niceStep(7)).toBe(10);
  });

  it('works at the magnitudes crypto prices actually live at', () => {
    expect(niceStep(0.000_003_4)).toBeCloseTo(0.000_005, 10);
    expect(niceStep(3400)).toBe(5000);
  });

  it('refuses to return a zero or negative step', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});

describe('niceTicks', () => {
  it('lands on round numbers inside the range', () => {
    const ticks = niceTicks(0, 100, 5);
    expect(ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('never emits a tick outside the range', () => {
    const ticks = niceTicks(3.2, 9.7, 4);
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(3.2);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(9.7);
  });

  it('keeps the spacing exact rather than drifting', () => {
    const ticks = niceTicks(0, 1, 10);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]! - ticks[i - 1]!).toBeCloseTo(ticks[1]! - ticks[0]!, 12);
    }
  });

  it('degenerates safely on a flat or invalid range', () => {
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(Number.NaN, 10)).toEqual([]);
  });
});

describe('movingAverage', () => {
  it('averages the trailing window', () => {
    expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('leaves positions before a full window null rather than part-averaging', () => {
    // An MA(25) drawn from 3 candles is not an MA(25).
    const out = movingAverage([10, 20, 30], 25);
    expect(out).toEqual([null, null, null]);
  });

  it('stays accurate over a long series, without accumulated drift', () => {
    const values = Array.from({ length: 500 }, (_, i) => i + 1);
    const out = movingAverage(values, 10);
    // Last window is 491..500.
    expect(out[499]).toBeCloseTo(495.5, 9);
  });

  it('passes values through for a period of one', () => {
    expect(movingAverage([3, 1, 4], 1)).toEqual([3, 1, 4]);
  });
});

describe('tickIndices', () => {
  it('includes both ends', () => {
    const indices = tickIndices(100, 5);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(99);
  });

  it('returns every index when the series is shorter than the target', () => {
    expect(tickIndices(3, 5)).toEqual([0, 1, 2]);
  });

  it('never repeats an index', () => {
    const indices = tickIndices(4, 4);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it('is empty for an empty series', () => {
    expect(tickIndices(0, 5)).toEqual([]);
  });
});

describe('formatAxisTime', () => {
  const ts = Date.UTC(2026, 2, 14, 9, 30);

  it('labels intraday timeframes with a clock time', () => {
    expect(formatAxisTime(ts, '1h')).toMatch(/\d{2}:\d{2}/);
    expect(formatAxisTime(ts, '15m')).toMatch(/\d{2}:\d{2}/);
  });

  it('labels daily and weekly timeframes with a date', () => {
    // A weekly chart labelled with clock times says 00:00 all the way across.
    expect(formatAxisTime(ts, '1d')).not.toMatch(/^\d{2}:\d{2}$/);
    expect(formatAxisTime(ts, '1w')).not.toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('priceExtent', () => {
  it('spans the highs and lows with padding', () => {
    const extent = priceExtent([candle(1, 10, 12, 8, 11), candle(2, 11, 15, 9, 14)], 0.1);
    expect(extent.top).toBeCloseTo(15 + 0.7);
    expect(extent.bottom).toBeCloseTo(8 - 0.7);
  });

  it('never pads below zero, because a negative price axis is nonsense', () => {
    expect(priceExtent([candle(1, 0.1, 0.1, 0.01, 0.05)], 5).bottom).toBe(0);
  });

  it('gives a usable range for a flat series', () => {
    const extent = priceExtent([candle(1, 5, 5, 5, 5), candle(2, 5, 5, 5, 5)]);
    expect(extent.top).toBeGreaterThan(extent.bottom);
  });

  it('has a safe default for no candles', () => {
    expect(priceExtent([])).toEqual({ top: 1, bottom: 0 });
  });
});

describe('formatAxisPrice', () => {
  it('shows only the decimals the step resolves', () => {
    // A gridline every 10 does not justify four decimal places.
    expect(formatAxisPrice(120, 10)).toBe('120');
    expect(formatAxisPrice(1.234, 0.001)).toBe('1.234');
  });

  it('keeps enough places to tell neighbouring ticks apart', () => {
    // A 0.25 step is order 0.1 but needs two places — one would print
    // successive gridlines as "0.3" and "0.5".
    expect(formatAxisPrice(0.25, 0.25)).toBe('0.25');
    expect(formatAxisPrice(0.5, 0.25)).toBe('0.50');
  });

  it('derives decimals from the step, not its magnitude', () => {
    expect(decimalsForStep(10)).toBe(0);
    expect(decimalsForStep(2.5)).toBe(1);
    expect(decimalsForStep(0.25)).toBe(2);
    expect(decimalsForStep(0.005)).toBe(3);
  });

  it('falls back to subscript notation for sub-milli prices', () => {
    expect(formatAxisPrice(0.0000342, 0.00001)).toMatch(/[₀-₉]/);
  });

  it('handles a zero step without producing NaN decimals', () => {
    expect(formatAxisPrice(42, 0)).toBe('42');
  });
});
