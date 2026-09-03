import type { Candle, Timeframe } from '../../core/types';
import { formatSubscriptNumber } from '../../utils/format';

/**
 * Round numbers a person would choose for an axis.
 *
 * A price axis labelled 0.003471 / 0.004118 / 0.004765 is arithmetically
 * correct and useless — the reader has to do subtraction to know what the
 * spacing means. Steps are snapped to 1, 2, 2.5 or 5 times a power of ten, so
 * the gap between gridlines is a number you can hold in your head.
 */
export function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const stop = [1, 2, 2.5, 5, 10].find((candidate) => normalised <= candidate) ?? 10;
  return stop * magnitude;
}

/** Ticks covering [min, max] at roughly `target` intervals, on nice values. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max <= min) return [min];
  const step = niceStep((max - min) / Math.max(1, target));
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  // Accumulating with multiplication rather than repeated addition keeps the
  // floating-point error from walking the later ticks off their nice values.
  for (let i = 0; first + i * step <= max + step * 1e-9; i += 1) {
    ticks.push(first + i * step);
    if (ticks.length > 64) break;
  }
  return ticks;
}

/**
 * Axis label for a tick, at the precision its own step justifies.
 *
 * A step of 10 labelled "120.0000" invites the reader to look for meaning in
 * four zeros that carry none. Decimals come from the gap between gridlines, so
 * the label says exactly as much as the axis actually resolves.
 */
export function formatAxisPrice(value: number, step: number): string {
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) < 0.001 && value !== 0) return formatSubscriptNumber(value, 3);
  return value.toFixed(decimalsForStep(step));
}

/**
 * Decimals needed to write `step` exactly, not decimals implied by its
 * magnitude. A step of 0.25 is order 0.1 but needs two places — rounding it to
 * one would print two neighbouring gridlines as "0.3" and "0.5".
 */
export function decimalsForStep(step: number): number {
  const magnitude = Math.abs(step);
  if (!Number.isFinite(magnitude) || magnitude === 0) return 0;
  for (let decimals = 0; decimals <= 8; decimals += 1) {
    const scaled = magnitude * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return decimals;
  }
  return 8;
}

/**
 * Simple moving average over `period` samples.
 *
 * Positions before the window is full are null rather than a partial average:
 * an MA(25) drawn from 3 candles is not an MA(25), and drawing it as one is a
 * quiet lie about how much history the line represents.
 */
export function movingAverage(values: number[], period: number): (number | null)[] {
  if (period <= 1) return values.map((value) => value);
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i] ?? 0;
    if (i >= period) sum -= values[i - period] ?? 0;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Roughly evenly spaced indices into a series of `length`, ends included. */
export function tickIndices(length: number, target: number): number[] {
  if (length <= 0) return [];
  if (length <= target) return Array.from({ length }, (_, i) => i);
  const count = Math.max(2, target);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(Math.round((i * (length - 1)) / (count - 1)));
  }
  return [...new Set(out)];
}

/**
 * Axis label for a timestamp, at the resolution the timeframe implies.
 *
 * An hourly chart labelled with dates repeats the same date six times; a weekly
 * one labelled with clock times says 00:00 all the way across.
 */
export function formatAxisTime(ts: number, timeframe: Timeframe): string {
  const date = new Date(ts);
  if (timeframe === '1d' || timeframe === '1w') {
    return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
  }
  if (timeframe === '4h') {
    return date.toLocaleString([], { day: '2-digit', hour: '2-digit', hour12: false }).replace(',', ' ');
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Price extent of the visible candles, padded so nothing touches the frame. */
export function priceExtent(candles: Candle[], padFraction = 0.06): { top: number; bottom: number } {
  if (!candles.length) return { top: 1, bottom: 0 };
  let max = -Infinity;
  let min = Infinity;
  for (const candle of candles) {
    max = Math.max(max, candle.h);
    min = Math.min(min, candle.l);
  }
  const span = max - min || Math.abs(max) || 1;
  const pad = span * padFraction;
  return { top: max + pad, bottom: Math.max(0, min - pad) };
}
