import { describe, expect, it } from 'vitest';
import { DemoMarketDataProvider } from '../market/DemoMarketDataProvider';
import { findToken, makePair, tokensForChain, sameToken } from '../market/tokens';
import { DemoChainProvider } from '../chain/DemoChainProvider';
import { PortfolioService } from '../portfolio/PortfolioService';
import { EventBus } from '../../core/events/bus';
import { fromBaseUnits, toBaseUnits, encodeApprove } from '../chain/abi';

const hex = findToken(369, 'HEX')!;
const pls = findToken(369, 'PLS')!;

describe('DemoMarketDataProvider', () => {
  it('marks everything it returns as simulated', async () => {
    const market = new DemoMarketDataProvider(0);
    const snapshot = await market.getMarket(hex);
    expect(snapshot.simulated).toBe(true);
    expect(snapshot.priceUsd).toBeGreaterThan(0);
  });

  it('is deterministic for the same token', async () => {
    const a = await new DemoMarketDataProvider(0).getMarket(hex);
    const b = await new DemoMarketDataProvider(0).getMarket(hex);
    expect(a.priceUsd).toBeCloseTo(b.priceUsd, 12);
  });

  it('builds a candle series ending at the current ratio', async () => {
    const market = new DemoMarketDataProvider(0);
    const pair = makePair(hex, pls);
    const candles = await market.getOHLC(pair, '1h', 50);
    expect(candles).toHaveLength(50);
    for (const candle of candles) {
      expect(candle.h).toBeGreaterThanOrEqual(Math.max(candle.o, candle.c));
      expect(candle.l).toBeLessThanOrEqual(Math.min(candle.o, candle.c));
      expect(candle.l).toBeGreaterThan(0);
    }
    expect(candles[49]!.t).toBeGreaterThan(candles[0]!.t);
  });

  it('splits liquidity across venues that sum to the total', async () => {
    const snapshot = await new DemoMarketDataProvider(0).getLiquidity(makePair(hex, pls));
    const sum = snapshot.venues.reduce((acc, v) => acc + v.usd, 0);
    expect(sum).toBeCloseTo(snapshot.totalUsd, 4);
    expect(snapshot.venues.reduce((acc, v) => acc + v.sharePct, 0)).toBeCloseTo(100, 4);
  });

  it('pushes price updates to subscribers on tick', () => {
    const market = new DemoMarketDataProvider(0);
    const seen: number[] = [];
    const off = market.subscribePrice(hex, (snapshot) => seen.push(snapshot.priceUsd));
    market.tick();
    off();
    market.tick();
    expect(seen.length).toBe(2); // initial + one tick, none after unsubscribe
    market.dispose();
  });
});

describe('token catalogue', () => {
  it('scopes tokens to their chain and finds by symbol or address', () => {
    expect(tokensForChain(369).every((token) => token.chainId === 369)).toBe(true);
    expect(findToken(369, 'hex')?.symbol).toBe('HEX');
    expect(findToken(369, hex.address)?.symbol).toBe('HEX');
    expect(findToken(369, 'NOPE')).toBeUndefined();
  });

  it('compares tokens by chain and address', () => {
    expect(sameToken(hex, { ...hex })).toBe(true);
    expect(sameToken(hex, pls)).toBe(false);
    expect(sameToken(hex, null)).toBe(false);
  });
});

describe('base unit conversion', () => {
  it('round-trips through base units', () => {
    expect(toBaseUnits(1.5, 18)).toBe('1500000000000000000');
    expect(fromBaseUnits('1500000000000000000', 18)).toBeCloseTo(1.5, 12);
    expect(toBaseUnits(0, 18)).toBe('0');
  });

  it('encodes an ERC-20 approval with the standard selector', () => {
    const data = encodeApprove('0x1111111111111111111111111111111111111111', 1000n);
    expect(data.startsWith('0x095ea7b3')).toBe(true);
    expect(data).toHaveLength(2 + 8 + 64 + 64);
  });
});

describe('PortfolioService', () => {
  it('prices chain balances and weights the portfolio change', async () => {
    const bus = new EventBus();
    const service = new PortfolioService(bus, 0);
    const chain = new DemoChainProvider(369);
    const market = new DemoMarketDataProvider(0);
    const snapshot = await service.load('0x1111111111111111111111111111111111111111', chain, market);

    expect(snapshot.holdings.length).toBeGreaterThan(0);
    expect(snapshot.holdings.every((h) => h.valueUsd > 0)).toBe(true);
    expect(snapshot.totalValueUsd).toBeCloseTo(
      snapshot.holdings.reduce((acc, h) => acc + h.valueUsd, 0),
      6,
    );
    expect(snapshot.simulated).toBe(true);
    expect(snapshot.holdings[0]!.valueUsd).toBeGreaterThanOrEqual(snapshot.holdings[1]!.valueUsd);
  });

  it('caches within the TTL and refreshes when forced', async () => {
    const service = new PortfolioService(new EventBus(), 60_000);
    const chain = new DemoChainProvider(369);
    const market = new DemoMarketDataProvider(0);
    const first = await service.load('0xabc', chain, market);
    const second = await service.load('0xabc', chain, market);
    expect(second).toBe(first);
    const third = await service.load('0xabc', chain, market, { force: true });
    expect(third).not.toBe(first);
  });
});
