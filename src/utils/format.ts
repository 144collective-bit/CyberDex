export function formatUsd(value: number | null | undefined, options: { compact?: boolean; decimals?: number } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  // Exact zero is a clean $0.00; a real-but-negligible cost reads as "<$0.01",
  // never as a flat $0.00 that hides a nonzero fee.
  if (value === 0) return '$0.00';
  if (abs < 0.005) return value > 0 ? '<$0.01' : '>-$0.01';
  if (options.compact && abs >= 1000) {
    return `$${compactNumber(value)}`;
  }
  const decimals = options.decimals ?? (abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6);
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) return `${(value / size).toFixed(abs / size >= 100 ? 0 : 2)}${suffix}`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatAmount(value: number | null | undefined, decimals?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e6) return compactNumber(value);
  const dp = decimals ?? (abs >= 1000 ? 2 : abs >= 1 ? 4 : 6);
  return value.toLocaleString(undefined, { maximumFractionDigits: dp });
}

const SUBSCRIPT_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

function subscript(count: number): string {
  return String(count)
    .split('')
    .map((digit) => SUBSCRIPT_DIGITS[Number(digit)] ?? digit)
    .join('');
}

/**
 * Compact notation for tokens with many leading zeros.
 *
 * On PulseChain most prices look like 0.00001025, which is slow to read and
 * wastes width in a dense terminal. The convention used across this ecosystem
 * writes the run of zeros as a subscript count: 0.0₄1025.
 */
export function formatSubscriptNumber(value: number, significantDigits = 4): string {
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  const [mantissa, exponentPart] = abs.toExponential(significantDigits - 1).split('e');
  const exponent = Number(exponentPart);
  const digits = (mantissa ?? '').replace('.', '').replace(/0+$/, '') || '0';
  // Zeros sit between the decimal point and the first significant digit.
  const zeros = -exponent - 1;
  const sign = value < 0 ? '-' : '';
  if (zeros < 1) return `${sign}${abs.toPrecision(significantDigits)}`;
  if (zeros < 3) return `${sign}0.${'0'.repeat(zeros)}${digits}`;
  return `${sign}0.0${subscript(zeros)}${digits}`;
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '$0';
  if (abs >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (abs >= 1) return `$${value.toFixed(4)}`;
  if (abs >= 0.001) return `$${value.toPrecision(4)}`;
  // Long runs of zeros collapse into subscript notation.
  return `$${formatSubscriptNumber(value)}`;
}

export function formatPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

/** Price impact: never rounded down to a flattering 0.00%. */
export function formatImpact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '0%';
  if (abs < 0.01) return '<0.01%';
  return `${value.toFixed(2)}%`;
}

export function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1000) return compactNumber(value);
  if (abs >= 1) return value.toFixed(4);
  if (abs >= 0.001) return value.toPrecision(4);
  return formatSubscriptNumber(value);
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatRelative(ts: number, now = Date.now()): string {
  const delta = Math.max(0, now - ts);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export function trend(value: number | null | undefined): 'up' | 'down' | 'flat' {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}
