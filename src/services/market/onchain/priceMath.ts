import type { Reserves } from '../../chain/abi';

/**
 * Reserve maths for a constant-product pool.
 *
 * Everything here is pure and works in bigint where precision matters, because
 * these numbers decide what a user is quoted and what they trade against.
 */

export interface PoolSnapshot {
  pair: string;
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
  decimals0: number;
  decimals1: number;
}

/** Human-readable amount from base units. Display and ratio use only. */
export function humanise(raw: bigint, decimals: number): number {
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const remainder = raw % divisor;
  return Number(whole) + Number(remainder) / Number(divisor);
}

/**
 * Price of `token` denominated in the pool's other asset.
 * Returns null for an empty pool rather than a divide-by-zero infinity.
 */
export function priceInPool(pool: PoolSnapshot, token: string): number | null {
  const isToken0 = pool.token0.toLowerCase() === token.toLowerCase();
  const isToken1 = pool.token1.toLowerCase() === token.toLowerCase();
  if (!isToken0 && !isToken1) return null;

  const base = isToken0 ? humanise(pool.reserve0, pool.decimals0) : humanise(pool.reserve1, pool.decimals1);
  const quote = isToken0 ? humanise(pool.reserve1, pool.decimals1) : humanise(pool.reserve0, pool.decimals0);
  if (base <= 0 || quote <= 0) return null;
  return quote / base;
}

/** Total value locked in a pool, given a USD price for either side. */
export function poolLiquidityUsd(
  pool: PoolSnapshot,
  usdPrices: { token0?: number | null; token1?: number | null },
): number {
  const amount0 = humanise(pool.reserve0, pool.decimals0);
  const amount1 = humanise(pool.reserve1, pool.decimals1);
  const side0 = usdPrices.token0 != null ? amount0 * usdPrices.token0 : null;
  const side1 = usdPrices.token1 != null ? amount1 * usdPrices.token1 : null;
  // A pool is balanced by construction, so one priced side implies the total.
  if (side0 != null && side1 != null) return side0 + side1;
  if (side0 != null) return side0 * 2;
  if (side1 != null) return side1 * 2;
  return 0;
}

/**
 * USD price for a token, routed through the wrapped native asset.
 *
 * Direct stable pools win when they exist; otherwise the token is priced in
 * native, and native in a stable. Returns null when neither route resolves —
 * a missing price must read as "unknown", never as zero.
 */
export function usdPrice(input: {
  token: string;
  directStablePool?: PoolSnapshot | null;
  nativePool?: PoolSnapshot | null;
  nativeUsd?: number | null;
  wrappedNative: string;
}): number | null {
  const { token, directStablePool, nativePool, nativeUsd, wrappedNative } = input;

  if (token.toLowerCase() === wrappedNative.toLowerCase()) return nativeUsd ?? null;

  if (directStablePool) {
    const price = priceInPool(directStablePool, token);
    if (price != null && price > 0) return price;
  }

  if (nativePool && nativeUsd != null) {
    const priceInNative = priceInPool(nativePool, token);
    if (priceInNative != null && priceInNative > 0) return priceInNative * nativeUsd;
  }

  return null;
}

/** Deepest pool by reserve of the reference asset — the one worth pricing from. */
export function deepestPool(pools: PoolSnapshot[], reference: string): PoolSnapshot | null {
  let best: PoolSnapshot | null = null;
  let bestDepth = 0;
  for (const pool of pools) {
    const isToken0 = pool.token0.toLowerCase() === reference.toLowerCase();
    const isToken1 = pool.token1.toLowerCase() === reference.toLowerCase();
    if (!isToken0 && !isToken1) continue;
    const depth = isToken0
      ? humanise(pool.reserve0, pool.decimals0)
      : humanise(pool.reserve1, pool.decimals1);
    if (depth > bestDepth) {
      bestDepth = depth;
      best = pool;
    }
  }
  return best;
}

/**
 * Constant-product output for a swap, matching the UniswapV2 router.
 * `feeBps` is the fee in basis points (PulseX V2 charges 29).
 */
export function amountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps = 29): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * BigInt(10_000 - feeBps);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 10_000n + amountInWithFee;
  return numerator / denominator;
}

/**
 * Price impact of a trade, as a percentage.
 *
 * Compares the executed rate against the pool's mid price, which is what a
 * trader actually loses to depth — not the fee, which is charged separately.
 */
export function priceImpactPct(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps = 29): number {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0;
  const out = amountOut(amountIn, reserveIn, reserveOut, feeBps);
  if (out <= 0n) return 100;
  const midPrice = Number(reserveOut) / Number(reserveIn);
  const executed = Number(out) / Number(amountIn);
  if (midPrice <= 0) return 0;
  const impact = (1 - executed / midPrice) * 100;
  return Math.max(0, impact);
}

/** Pool snapshot assembled from raw reserve output plus known decimals. */
export function toPoolSnapshot(
  pair: string,
  token0: string,
  token1: string,
  reserves: Reserves,
  decimals0: number,
  decimals1: number,
): PoolSnapshot {
  return {
    pair,
    token0,
    token1,
    reserve0: reserves.reserve0,
    reserve1: reserves.reserve1,
    decimals0,
    decimals1,
  };
}
