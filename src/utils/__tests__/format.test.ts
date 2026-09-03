import { describe, expect, it } from 'vitest';
import {
  compactNumber,
  formatImpact,
  formatPct,
  formatPrice,
  formatRatio,
  formatSubscriptNumber,
  formatUsd,
} from '../format';

describe('formatSubscriptNumber', () => {
  it('writes a long run of zeros as a subscript count', () => {
    // 0.00001025 → 4 zeros after the point, then the significant digits.
    expect(formatSubscriptNumber(0.00001025)).toBe('0.0₄1025');
    expect(formatSubscriptNumber(0.0000342)).toBe('0.0₄342');
    expect(formatSubscriptNumber(0.000000001)).toBe('0.0₈1');
  });

  it('leaves short runs of zeros written out', () => {
    expect(formatSubscriptNumber(0.0342)).toBe('0.0342');
    expect(formatSubscriptNumber(0.00342)).toBe('0.00342');
  });

  it('handles zero and negatives', () => {
    expect(formatSubscriptNumber(0)).toBe('0');
    expect(formatSubscriptNumber(-0.00001025)).toBe('-0.0₄1025');
  });

  it('round-trips to the value it represents', () => {
    const rendered = formatSubscriptNumber(0.00001025);
    const zeros = Number(rendered.match(/₍?([₀-₉]+)/)?.[1]?.replace(/[₀-₉]/g, (d) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(d))));
    const digits = rendered.split(/[₀-₉]/).pop()!;
    expect(Number(`0.${'0'.repeat(zeros)}${digits}`)).toBeCloseTo(0.00001025, 12);
  });
});

describe('formatPrice', () => {
  it('uses subscript notation only below a thousandth', () => {
    expect(formatPrice(0.0000342)).toBe('$0.0₄342');
    expect(formatPrice(0.004312)).toBe('$0.004312');
    expect(formatPrice(1.5)).toBe('$1.5000');
    expect(formatPrice(3420.55)).toBe('$3,420.55');
  });

  it('renders zero and missing values distinctly', () => {
    expect(formatPrice(0)).toBe('$0');
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice(Number.NaN)).toBe('—');
  });
});

describe('formatRatio', () => {
  it('collapses zeros for tiny ratios and compacts large ones', () => {
    expect(formatRatio(0.0000342)).toBe('0.0₄342');
    expect(formatRatio(127.4903)).toBe('127.4903');
    expect(formatRatio(15_000)).toBe('15.00K');
  });
});

describe('other formatters', () => {
  it('formats percentages with an explicit sign', () => {
    expect(formatPct(2.5)).toBe('+2.50%');
    expect(formatPct(-2.5)).toBe('-2.50%');
    expect(formatPct(null)).toBe('—');
  });

  it('never rounds a real price impact down to zero', () => {
    expect(formatImpact(0.0001)).toBe('<0.01%');
    expect(formatImpact(0)).toBe('0%');
    expect(formatImpact(3.456)).toBe('3.46%');
  });

  it('marks a negligible cost rather than showing $0.00', () => {
    expect(formatUsd(0.0001)).toBe('<$0.01');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(1250, { compact: true })).toBe('$1.25K');
  });

  it('compacts large numbers', () => {
    expect(compactNumber(1_250_000)).toBe('1.25M');
    expect(compactNumber(742_000_000_000)).toBe('742B');
  });
});
