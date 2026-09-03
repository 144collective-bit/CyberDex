import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/events/bus';
import { HttpClient } from '../http/HttpClient';
import {
  GeckoTerminalProvider,
  UnsupportedChainError,
  mapCandles,
  mapLiquidity,
  mapTokenMarket,
  toNumber,
} from '../market/GeckoTerminalProvider';
import { ResilientMarketProvider } from '../market/ResilientMarketProvider';
import { DemoMarketDataProvider } from '../market/DemoMarketDataProvider';
import { findToken, makePair } from '../market/tokens';

const hex = findToken(369, 'HEX')!;
const pls = findToken(369, 'PLS')!;
const pair = makePair(hex, pls);

function client(routes: Record<string, unknown>, onCall?: (url: string) => void) {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
    const key = String(url);
    onCall?.(key);
    const match = Object.keys(routes).find((route) => key.includes(route));
    if (!match) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(routes[match]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return new HttpClient({
    baseUrl: 'https://api.test/api/v2',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    cacheTtlMs: 0,
    minIntervalMs: 0,
    retries: 0,
  });
}

describe('GeckoTerminal mappers', () => {
  it('parses numbers that arrive as strings, and tolerates junk', () => {
    expect(toNumber('12.5')).toBe(12.5);
    expect(toNumber(7)).toBe(7);
    expect(toNumber(null)).toBe(0);
    expect(toNumber('not a number', -1)).toBe(-1);
    expect(toNumber(Number.NaN)).toBe(0);
  });

  it('maps a token payload into the app market model', () => {
    const market = mapTokenMarket(
      hex,
      {
        data: {
          attributes: {
            price_usd: '0.004312',
            volume_usd: { h24: '1180000.25' },
            total_reserve_in_usd: '18400000',
            market_cap_usd: null,
            fdv_usd: '742000000',
          },
        },
      },
      1_700_000_000_000,
    );
    expect(market.priceUsd).toBeCloseTo(0.004312, 9);
    expect(market.volume24hUsd).toBeCloseTo(1_180_000.25, 4);
    expect(market.liquidityUsd).toBe(18_400_000);
    // Falls back to FDV when market cap is absent.
    expect(market.marketCapUsd).toBe(742_000_000);
    expect(market.simulated).toBe(false);
    expect(market.updatedAt).toBe(1_700_000_000_000);
  });

  it('survives an empty or unexpected token payload', () => {
    const market = mapTokenMarket(hex, {}, 1);
    expect(market.priceUsd).toBe(0);
    expect(market.token.symbol).toBe('HEX');
  });

  it('maps OHLCV rows to candles in chronological order', () => {
    const candles = mapCandles({
      data: {
        attributes: {
          ohlcv_list: [
            [1700000600, '1.2', '1.4', '1.1', '1.3', '5000'],
            [1700000000, 1.0, 1.25, 0.95, 1.2, 4000],
          ],
        },
      },
    });
    expect(candles).toHaveLength(2);
    expect(candles[0]!.t).toBe(1_700_000_000_000);
    expect(candles[1]!.t).toBe(1_700_000_600_000);
    expect(candles[0]!.o).toBe(1);
    expect(candles[1]!.c).toBe(1.3);
  });

  it('drops malformed candle rows rather than plotting zeros', () => {
    const candles = mapCandles({
      data: { attributes: { ohlcv_list: [[0, 0, 0, 0, 0, 0], [1700000000, 1, 2, 0.5, 1.5, 10]] } },
    });
    expect(candles).toHaveLength(1);
  });

  it('maps pools into venue shares that sum to the total', () => {
    const snapshot = mapLiquidity(
      pair,
      {
        data: [
          { attributes: { name: 'HEX / WPLS', reserve_in_usd: '1000000', price_change_percentage: { h24: '-3.5' } } },
          { attributes: { name: 'HEX / DAI', reserve_in_usd: '250000' } },
          { attributes: { name: 'EMPTY', reserve_in_usd: '0' } },
        ],
      },
      5,
    );
    expect(snapshot.totalUsd).toBe(1_250_000);
    expect(snapshot.venues).toHaveLength(2);
    expect(snapshot.venues.reduce((acc, venue) => acc + venue.sharePct, 0)).toBeCloseTo(100, 6);
    expect(snapshot.change24hPct).toBe(-3.5);
    expect(snapshot.simulated).toBe(false);
  });
});

describe('GeckoTerminalProvider', () => {
  it('fetches a token price and the deepest pool for its change figure', async () => {
    const calls: string[] = [];
    const provider = new GeckoTerminalProvider({
      http: client(
        {
          '/tokens/0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39/pools': {
            data: [
              { attributes: { name: 'HEX / WPLS', reserve_in_usd: '900000', price_change_percentage: { h24: '2.5' } } },
              { attributes: { name: 'HEX / DAI', reserve_in_usd: '5000000', price_change_percentage: { h24: '4.75' } } },
            ],
          },
          '/tokens/': { data: { attributes: { price_usd: '0.0043', volume_usd: { h24: '1000' } } } },
        },
        (url) => calls.push(url),
      ),
    });

    const market = await provider.getMarket(hex);
    expect(market.priceUsd).toBeCloseTo(0.0043, 8);
    // 4.75 comes from the deeper pool, not the first one listed.
    expect(market.change24hPct).toBe(4.75);
    expect(calls.some((url) => url.includes('/networks/pulsechain/tokens/'))).toBe(true);
  });

  it('prices a native token through its wrapped contract', async () => {
    const calls: string[] = [];
    const provider = new GeckoTerminalProvider({
      http: client({ '/tokens/': { data: { attributes: { price_usd: '0.000034' } } } }, (url) => calls.push(url)),
    });
    await provider.getMarket(pls);
    expect(calls[0]).toContain(findToken(369, 'WPLS')!.address);
  });

  it('refuses a chain it has no network slug for', async () => {
    const provider = new GeckoTerminalProvider({ http: client({}) });
    await expect(provider.getMarket({ ...hex, chainId: 999 })).rejects.toBeInstanceOf(UnsupportedChainError);
  });

  it('keeps the last good price for a token whose refresh failed', async () => {
    let fail = false;
    const http = new HttpClient({
      baseUrl: 'https://api.test',
      fetchImpl: (async () =>
        fail
          ? new Response('{}', { status: 500 })
          : new Response(JSON.stringify({ data: { attributes: { price_usd: '1.5' } } }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })) as unknown as typeof fetch,
      cacheTtlMs: 0,
      retries: 0,
      minIntervalMs: 0,
    });
    const provider = new GeckoTerminalProvider({ http });
    await provider.getMarket(hex);
    fail = true;
    const markets = await provider.getMarkets([hex]);
    expect(markets).toHaveLength(1);
    expect(markets[0]!.priceUsd).toBe(1.5);
  });

  it('returns no candles rather than inventing them when no pool matches', async () => {
    const provider = new GeckoTerminalProvider({ http: client({ '/pools': { data: [] } }) });
    await expect(provider.getOHLC(pair, '1h')).resolves.toEqual([]);
  });

  it('reports no whale movements instead of fabricating them', async () => {
    const provider = new GeckoTerminalProvider({ http: client({}) });
    await expect(provider.getWhaleMovements()).resolves.toEqual([]);
  });
});

describe('ResilientMarketProvider', () => {
  function harness(primary: Partial<MarketStub> = {}) {
    const bus = new EventBus();
    const demo = new DemoMarketDataProvider(0);
    const stub = new MarketStub(primary);
    const provider = new ResilientMarketProvider(stub, demo, bus, { tolerance: 2 });
    return { provider, stub, bus, demo };
  }

  it('serves live data while the primary is healthy', async () => {
    const { provider } = harness();
    const market = await provider.getMarket(hex);
    expect(market.simulated).toBe(false);
    expect(provider.origin).toBe('live');
    expect(provider.getStatus().usingFallback).toBe(false);
  });

  it('falls back to demo data after repeated failures and says so once', async () => {
    const { provider, stub, bus } = harness();
    const notices = vi.fn();
    bus.on('SYSTEM_NOTICE', notices);
    stub.failing = true;

    const first = await provider.getMarket(hex);
    expect(first.simulated).toBe(true); // demo answered, but the feed is not written off yet
    expect(provider.getStatus().usingFallback).toBe(false);

    await provider.getMarket(hex);
    expect(provider.getStatus().usingFallback).toBe(true);
    expect(provider.origin).toBe('demo');
    expect(notices).toHaveBeenCalledTimes(1);

    // Still down, but the user is not told again on every call.
    await provider.getMarket(hex);
    expect(notices).toHaveBeenCalledTimes(1);
  });

  it('reports degraded health while on the fallback', async () => {
    const { provider, stub } = harness();
    stub.failing = true;
    await provider.getMarket(hex);
    await provider.getMarket(hex);
    await expect(provider.health()).resolves.toBe('degraded');
  });

  it('returns to live data when the primary recovers', async () => {
    const { provider, stub, bus } = harness();
    const notices: string[] = [];
    bus.on('SYSTEM_NOTICE', ({ message }) => notices.push(message));
    stub.failing = true;
    await provider.getMarket(hex);
    await provider.getMarket(hex);
    expect(provider.getStatus().usingFallback).toBe(true);

    stub.failing = false;
    await expect(provider.recheck()).resolves.toBe(true);
    expect(provider.getStatus().usingFallback).toBe(false);
    expect(provider.origin).toBe('live');
    expect(notices.some((message) => message.includes('RESTORED'))).toBe(true);
  });

  it('stays on the fallback while the primary is still unhealthy', async () => {
    const { provider, stub } = harness();
    stub.failing = true;
    await provider.getMarket(hex);
    await provider.getMarket(hex);
    await expect(provider.recheck()).resolves.toBe(false);
    expect(provider.getStatus().usingFallback).toBe(true);
  });
});

/** Minimal live-provider stand-in whose failure can be toggled. */
class MarketStub {
  readonly id = 'stub';
  readonly label = 'STUB';
  readonly origin = 'live' as const;
  failing = false;

  constructor(overrides: Partial<MarketStub> = {}) {
    Object.assign(this, overrides);
  }

  private check() {
    if (this.failing) throw new Error('upstream 502');
  }

  async listTokens() {
    this.check();
    return [hex];
  }
  async getToken() {
    this.check();
    return hex;
  }
  async getMarket() {
    this.check();
    return {
      token: hex,
      priceUsd: 1,
      change24hPct: 0,
      change7dPct: 0,
      volume24hUsd: 0,
      liquidityUsd: 0,
      marketCapUsd: 0,
      updatedAt: Date.now(),
      simulated: false,
    };
  }
  async getMarkets() {
    this.check();
    return [await this.getMarket()];
  }
  async getOHLC() {
    this.check();
    return [];
  }
  async getLiquidity() {
    this.check();
    return { pair, totalUsd: 0, venues: [], change24hPct: 0, updatedAt: Date.now(), simulated: false };
  }
  async getWhaleMovements() {
    this.check();
    return [];
  }
  subscribePrice() {
    return () => undefined;
  }
  async health() {
    return this.failing ? ('offline' as const) : ('online' as const);
  }
}

describe('ResilientMarketProvider price subscriptions', () => {
  it('delivers prices from the primary and trips the fallback on failure', async () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    const demo = new DemoMarketDataProvider(2500);
    const stub = new MarketStub();
    const provider = new ResilientMarketProvider(stub, demo, bus, { tolerance: 2, pollMs: 1000 });

    const received: number[] = [];
    const off = provider.subscribePrice(hex, (market) => received.push(market.priceUsd));
    await vi.advanceTimersByTimeAsync(10);
    expect(received).toEqual([1]);

    // Primary goes down: the poll keeps running and the feed flips over.
    stub.failing = true;
    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(1100);
    expect(provider.getStatus().usingFallback).toBe(true);
    // Prices keep arriving — from the demo feed, which the UI labels.
    expect(received.length).toBeGreaterThan(1);

    off();
    vi.useRealTimers();
    demo.dispose();
  });

  it('stops polling once the last subscriber unsubscribes', async () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    const demo = new DemoMarketDataProvider(2500);
    const stub = new MarketStub();
    const provider = new ResilientMarketProvider(stub, demo, bus, { pollMs: 500 });
    const seen: number[] = [];
    const off = provider.subscribePrice(hex, (market) => seen.push(market.priceUsd));
    await vi.advanceTimersByTimeAsync(600);
    const count = seen.length;
    off();
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen.length).toBe(count);
    vi.useRealTimers();
    demo.dispose();
  });
});
