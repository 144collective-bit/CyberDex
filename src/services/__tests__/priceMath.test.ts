import { describe, expect, it } from 'vitest';
import {
  amountOut,
  deepestPool,
  humanise,
  poolLiquidityUsd,
  priceImpactPct,
  priceInPool,
  usdPrice,
} from '../market/onchain/priceMath';
import type { PoolSnapshot } from '../market/onchain/priceMath';

const WPLS = '0xA1077a294dDE1B09bB078844df40758a5D0f9a27';
const HEX = '0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39';
const DAI = '0xefD766cCb38EaF1dfd701853BFCe31359239F305';

const pool = (over: Partial<PoolSnapshot> = {}): PoolSnapshot => ({
  pair: '0xpair',
  token0: HEX,
  token1: WPLS,
  reserve0: 1_000_000n * 10n ** 8n, // 1,000,000 HEX (8 decimals)
  reserve1: 100_000_000n * 10n ** 18n, // 100,000,000 WPLS
  decimals0: 8,
  decimals1: 18,
  ...over,
});

describe('humanise', () => {
  it('converts base units across decimal scales', () => {
    expect(humanise(10n ** 18n, 18)).toBe(1);
    expect(humanise(150_000_000n, 8)).toBe(1.5);
    expect(humanise(0n, 6)).toBe(0);
  });
});

describe('priceInPool', () => {
  it('prices a token in its counterpart, respecting decimals', () => {
    // 100,000,000 WPLS per 1,000,000 HEX = 100 WPLS per HEX.
    expect(priceInPool(pool(), HEX)).toBeCloseTo(100, 9);
    expect(priceInPool(pool(), WPLS)).toBeCloseTo(0.01, 9);
  });

  it('returns null for a token that is not in the pool', () => {
    expect(priceInPool(pool(), DAI)).toBeNull();
  });

  it('returns null for an empty pool instead of infinity', () => {
    expect(priceInPool(pool({ reserve0: 0n }), HEX)).toBeNull();
    expect(priceInPool(pool({ reserve1: 0n }), HEX)).toBeNull();
  });

  it('is case-insensitive about addresses', () => {
    expect(priceInPool(pool(), HEX.toLowerCase())).toBeCloseTo(100, 9);
  });
});

describe('usdPrice', () => {
  const nativePool = pool();
  const stablePool = pool({
    token0: HEX,
    token1: DAI,
    reserve0: 1_000_000n * 10n ** 8n,
    reserve1: 4_000n * 10n ** 18n,
    decimals0: 8,
    decimals1: 18,
  });

  it('prefers a direct stable pool', () => {
    const price = usdPrice({ token: HEX, directStablePool: stablePool, nativePool, nativeUsd: 0.00003, wrappedNative: WPLS });
    expect(price).toBeCloseTo(0.004, 9);
  });

  it('routes through the native asset when there is no stable pool', () => {
    const price = usdPrice({ token: HEX, nativePool, nativeUsd: 0.00003, wrappedNative: WPLS });
    // 100 WPLS per HEX × $0.00003 = $0.003
    expect(price).toBeCloseTo(0.003, 9);
  });

  it('returns the native price for the wrapped native token itself', () => {
    expect(usdPrice({ token: WPLS, nativeUsd: 0.000034, wrappedNative: WPLS })).toBe(0.000034);
  });

  it('returns null rather than zero when no route resolves', () => {
    expect(usdPrice({ token: HEX, wrappedNative: WPLS })).toBeNull();
    expect(usdPrice({ token: HEX, nativePool, nativeUsd: null, wrappedNative: WPLS })).toBeNull();
  });

  it('ignores an empty stable pool and falls through to the native route', () => {
    const empty = pool({ token0: HEX, token1: DAI, reserve0: 0n, reserve1: 0n });
    const price = usdPrice({ token: HEX, directStablePool: empty, nativePool, nativeUsd: 0.00003, wrappedNative: WPLS });
    expect(price).toBeCloseTo(0.003, 9);
  });
});

describe('poolLiquidityUsd', () => {
  it('doubles one priced side, since a pool is balanced by construction', () => {
    const value = poolLiquidityUsd(pool(), { token0: 0.004 });
    // 1,000,000 HEX × $0.004 = $4,000 on one side → $8,000 total.
    expect(value).toBeCloseTo(8_000, 6);
  });

  it('sums both sides when both are priced', () => {
    const value = poolLiquidityUsd(pool(), { token0: 0.004, token1: 0.00003 });
    expect(value).toBeCloseTo(4_000 + 3_000, 6);
  });

  it('is zero when nothing can be priced', () => {
    expect(poolLiquidityUsd(pool(), {})).toBe(0);
  });
});

describe('deepestPool', () => {
  it('picks the pool holding most of the reference asset', () => {
    const shallow = pool({ pair: '0xshallow', reserve0: 10n * 10n ** 8n });
    const deep = pool({ pair: '0xdeep', reserve0: 5_000_000n * 10n ** 8n });
    expect(deepestPool([shallow, deep], HEX)?.pair).toBe('0xdeep');
  });

  it('ignores pools that do not contain the reference asset', () => {
    const unrelated = pool({ token0: DAI, token1: WPLS });
    expect(deepestPool([unrelated], HEX)).toBeNull();
  });
});

describe('constant product maths', () => {
  const reserveIn = 1_000_000n * 10n ** 18n;
  const reserveOut = 2_000_000n * 10n ** 18n;

  it('matches the UniswapV2 formula with the configured fee', () => {
    const out = amountOut(1_000n * 10n ** 18n, reserveIn, reserveOut, 29);
    // Hand-computed: in*9971*outRes / (inRes*10000 + in*9971)
    const expected =
      (1_000n * 10n ** 18n * 9971n * reserveOut) / (reserveIn * 10_000n + 1_000n * 10n ** 18n * 9971n);
    expect(out).toBe(expected);
  });

  it('returns zero for degenerate inputs instead of dividing by zero', () => {
    expect(amountOut(0n, reserveIn, reserveOut)).toBe(0n);
    expect(amountOut(10n, 0n, reserveOut)).toBe(0n);
    expect(amountOut(10n, reserveIn, 0n)).toBe(0n);
  });

  it('grows price impact with trade size', () => {
    const small = priceImpactPct(10n * 10n ** 18n, reserveIn, reserveOut);
    const large = priceImpactPct(500_000n * 10n ** 18n, reserveIn, reserveOut);
    expect(large).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeLessThan(100);
  });

  it('never reports a negative impact', () => {
    expect(priceImpactPct(1n, reserveIn, reserveOut)).toBeGreaterThanOrEqual(0);
  });
});
