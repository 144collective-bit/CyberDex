import type {
  Candle,
  PairRef,
  ServiceHealth,
  Timeframe,
  TokenMarket,
  TokenRef,
  WhaleMovement,
} from '../../core/types';
import type { LiquiditySnapshot, MarketDataProvider } from './MarketDataProvider';
import { HttpClient } from '../http/HttpClient';
import { tokensForChain, findToken } from './tokens';

/**
 * GeckoTerminal REST shapes, as documented by the provider.
 *
 * Only the fields this app reads are declared, and every one is optional: a
 * public API is free to add, rename or omit fields, and a missing value must
 * degrade one number rather than break the module.
 */
interface GtTokenResponse {
  data?: {
    attributes?: {
      address?: string;
      symbol?: string;
      name?: string;
      decimals?: number;
      price_usd?: string | number | null;
      volume_usd?: { h24?: string | number | null } | null;
      total_reserve_in_usd?: string | number | null;
      market_cap_usd?: string | number | null;
      fdv_usd?: string | number | null;
    };
  };
}

interface GtPoolAttributes {
  address?: string;
  name?: string;
  base_token_price_usd?: string | number | null;
  quote_token_price_usd?: string | number | null;
  reserve_in_usd?: string | number | null;
  volume_usd?: { h24?: string | number | null } | null;
  price_change_percentage?: { h24?: string | number | null; h6?: string | number | null } | null;
  transactions?: unknown;
}

interface GtPoolsResponse {
  data?: { id?: string; attributes?: GtPoolAttributes; relationships?: unknown }[];
}

interface GtOhlcvResponse {
  data?: { attributes?: { ohlcv_list?: (number | string)[][] } };
}

/** Timeframe → GeckoTerminal's (period, aggregate) pair. */
export const GT_TIMEFRAMES: Record<Timeframe, { period: 'minute' | 'hour' | 'day'; aggregate: number }> = {
  '1m': { period: 'minute', aggregate: 1 },
  '5m': { period: 'minute', aggregate: 5 },
  '15m': { period: 'minute', aggregate: 15 },
  '1h': { period: 'hour', aggregate: 1 },
  '4h': { period: 'hour', aggregate: 4 },
  '1d': { period: 'day', aggregate: 1 },
  '1w': { period: 'day', aggregate: 7 },
};

/** GeckoTerminal network slugs for the chains this app knows. */
export const GT_NETWORKS: Record<number, string> = {
  369: 'pulsechain',
  1: 'eth',
  8453: 'base',
};

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** Pure mapper: token endpoint payload → the app's market model. */
export function mapTokenMarket(token: TokenRef, payload: GtTokenResponse, at: number): TokenMarket {
  const attributes = payload.data?.attributes ?? {};
  return {
    token,
    priceUsd: toNumber(attributes.price_usd),
    // The token endpoint carries no change figures; the pool lookup fills them in.
    change24hPct: 0,
    change7dPct: 0,
    volume24hUsd: toNumber(attributes.volume_usd?.h24),
    liquidityUsd: toNumber(attributes.total_reserve_in_usd),
    marketCapUsd: toNumber(attributes.market_cap_usd) || toNumber(attributes.fdv_usd),
    updatedAt: at,
    simulated: false,
  };
}

/** Pure mapper: OHLCV rows → candles, oldest first. */
export function mapCandles(payload: GtOhlcvResponse): Candle[] {
  const rows = payload.data?.attributes?.ohlcv_list ?? [];
  return rows
    .map((row) => ({
      t: toNumber(row[0]) * 1000,
      o: toNumber(row[1]),
      h: toNumber(row[2]),
      l: toNumber(row[3]),
      c: toNumber(row[4]),
      v: toNumber(row[5]),
    }))
    .filter((candle) => candle.t > 0 && candle.c > 0)
    .sort((a, b) => a.t - b.t);
}

/** Pure mapper: pools payload → the venue breakdown the liquidity module shows. */
export function mapLiquidity(pair: PairRef, payload: GtPoolsResponse, at: number): LiquiditySnapshot {
  const pools = (payload.data ?? [])
    .map((pool) => ({
      dex: pool.attributes?.name ?? 'POOL',
      usd: toNumber(pool.attributes?.reserve_in_usd),
    }))
    .filter((pool) => pool.usd > 0)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 6);

  const totalUsd = pools.reduce((acc, pool) => acc + pool.usd, 0);
  const change = toNumber(payload.data?.[0]?.attributes?.price_change_percentage?.h24);

  return {
    pair,
    totalUsd,
    venues: pools.map((pool) => ({
      dex: pool.dex,
      usd: pool.usd,
      sharePct: totalUsd > 0 ? (pool.usd / totalUsd) * 100 : 0,
    })),
    change24hPct: change,
    updatedAt: at,
    simulated: false,
  };
}

export class UnsupportedChainError extends Error {
  constructor(chainId: number) {
    super(`GeckoTerminal has no network mapping for chain ${chainId}`);
    this.name = 'UnsupportedChainError';
  }
}

/**
 * Live market data from GeckoTerminal's public API.
 *
 * NOTE: written against the provider's documented response shapes and covered
 * by fixture tests; it has not been run against the live endpoint from this
 * environment, whose egress is restricted. Every field is read defensively and
 * the system falls back to the demo feed when a call fails, so a schema drift
 * degrades to "no data" rather than a broken deck.
 */
export class GeckoTerminalProvider implements MarketDataProvider {
  readonly id = 'geckoterminal';
  readonly label = 'GECKOTERMINAL';
  readonly origin = 'live' as const;

  private http: HttpClient;
  private pollMs: number;
  private subscribers = new Map<string, Set<(market: TokenMarket) => void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastMarket = new Map<string, TokenMarket>();

  constructor(options: { http?: HttpClient; pollMs?: number } = {}) {
    this.http =
      options.http ??
      new HttpClient({
        baseUrl: 'https://api.geckoterminal.com/api/v2',
        // The public tier allows ~30 calls/minute; stay well inside it.
        minIntervalMs: 2100,
        cacheTtlMs: 15_000,
        timeoutMs: 12_000,
        retries: 2,
      });
    this.pollMs = options.pollMs ?? 20_000;
  }

  private network(chainId: number): string {
    const slug = GT_NETWORKS[chainId];
    if (!slug) throw new UnsupportedChainError(chainId);
    return slug;
  }

  private key(token: TokenRef): string {
    return `${token.chainId}:${token.address.toLowerCase()}`;
  }

  async listTokens(chainId: number): Promise<TokenRef[]> {
    // The catalogue is local; the API supplies prices for it, not membership.
    return tokensForChain(chainId);
  }

  async getToken(chainId: number, addressOrSymbol: string): Promise<TokenRef | null> {
    return findToken(chainId, addressOrSymbol) ?? null;
  }

  async getMarket(token: TokenRef): Promise<TokenMarket> {
    const network = this.network(token.chainId);
    const address = token.address === 'native' ? this.wrappedAddress(token) : token.address;
    const payload = await this.http.getJson<GtTokenResponse>(`/networks/${network}/tokens/${address}`);
    const market = mapTokenMarket(token, payload, Date.now());

    // Change percentages live on pools, so borrow them from the deepest one.
    try {
      const pools = await this.http.getJson<GtPoolsResponse>(
        `/networks/${network}/tokens/${address}/pools?page=1`,
      );
      const deepest = (pools.data ?? [])
        .slice()
        .sort((a, b) => toNumber(b.attributes?.reserve_in_usd) - toNumber(a.attributes?.reserve_in_usd))[0];
      if (deepest) {
        market.change24hPct = toNumber(deepest.attributes?.price_change_percentage?.h24);
      }
    } catch {
      // A missing change figure is not worth failing the whole quote over.
    }

    this.lastMarket.set(this.key(token), market);
    return market;
  }

  async getMarkets(tokens: TokenRef[]): Promise<TokenMarket[]> {
    const results = await Promise.allSettled(tokens.map((token) => this.getMarket(token)));
    const markets = results.flatMap((result, index) => {
      if (result.status === 'fulfilled') return [result.value];
      const token = tokens[index]!;
      const previous = this.lastMarket.get(this.key(token));
      // Keep the last good value rather than dropping the row entirely.
      return previous ? [previous] : [];
    });
    // Nothing came back and nothing was cached: this is a failure, not an empty
    // market, and the caller needs to know so it can fall back.
    if (markets.length === 0 && tokens.length > 0) {
      const firstRejection = results.find((result) => result.status === 'rejected');
      throw firstRejection && firstRejection.status === 'rejected'
        ? firstRejection.reason
        : new Error('No market data returned');
    }
    return markets;
  }

  async getOHLC(pair: PairRef, timeframe: Timeframe, limit = 160): Promise<Candle[]> {
    const network = this.network(pair.base.chainId);
    const pool = await this.findPool(pair);
    if (!pool) return [];
    const { period, aggregate } = GT_TIMEFRAMES[timeframe];
    const payload = await this.http.getJson<GtOhlcvResponse>(
      `/networks/${network}/pools/${pool}/ohlcv/${period}?aggregate=${aggregate}&limit=${limit}`,
    );
    return mapCandles(payload);
  }

  async getLiquidity(pair: PairRef): Promise<LiquiditySnapshot> {
    const network = this.network(pair.base.chainId);
    const address = pair.base.address === 'native' ? this.wrappedAddress(pair.base) : pair.base.address;
    const payload = await this.http.getJson<GtPoolsResponse>(`/networks/${network}/tokens/${address}/pools?page=1`);
    return mapLiquidity(pair, payload, Date.now());
  }

  async getWhaleMovements(): Promise<WhaleMovement[]> {
    // Not available from this API; the module shows its empty state instead of
    // inventing movements that look real.
    return [];
  }

  subscribePrice(token: TokenRef, handler: (market: TokenMarket) => void): () => void {
    const key = this.key(token);
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(handler);

    const cached = this.lastMarket.get(key);
    if (cached) handler(cached);
    void this.getMarket(token).then(handler).catch(() => undefined);

    this.start();
    return () => {
      set?.delete(handler);
      if (set && set.size === 0) this.subscribers.delete(key);
      if (this.subscribers.size === 0) this.stop();
    };
  }

  async health(): Promise<ServiceHealth> {
    try {
      await this.http.getJson('/networks?page=1', { cacheTtlMs: 60_000 });
      return 'online';
    } catch {
      return 'offline';
    }
  }

  /** Native tokens have no contract, so price the wrapped equivalent. */
  private wrappedAddress(token: TokenRef): string {
    const wrapped =
      findToken(token.chainId, `W${token.symbol}`) ?? findToken(token.chainId, token.symbol === 'ETH' ? 'WETH' : 'WPLS');
    return wrapped?.address ?? token.address;
  }

  private poolCache = new Map<string, string | null>();

  /**
   * Deepest pool for a pair, cached — pool addresses rarely change.
   *
   * A transport failure propagates: only a genuine "this pair has no pools"
   * answer is cached as null, so an outage is never mistaken for an empty
   * market by the fallback wrapper above.
   */
  private async findPool(pair: PairRef): Promise<string | null> {
    const cached = this.poolCache.get(pair.id);
    if (cached !== undefined) return cached;

    const network = this.network(pair.base.chainId);
    const address = pair.base.address === 'native' ? this.wrappedAddress(pair.base) : pair.base.address;
    const payload = await this.http.getJson<GtPoolsResponse>(`/networks/${network}/tokens/${address}/pools?page=1`);
    const quoteSymbol = pair.quote.symbol.toUpperCase();
    const pools = (payload.data ?? [])
      .slice()
      .sort((a, b) => toNumber(b.attributes?.reserve_in_usd) - toNumber(a.attributes?.reserve_in_usd));
    const match = pools.find((pool) => (pool.attributes?.name ?? '').toUpperCase().includes(quoteSymbol)) ?? pools[0];
    const poolAddress = match?.attributes?.address ?? null;
    this.poolCache.set(pair.id, poolAddress);
    return poolAddress;
  }

  private start(): void {
    if (this.timer || typeof setInterval !== 'function') return;
    this.timer = setInterval(() => void this.refresh(), this.pollMs);
  }

  private stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Re-price every subscribed token. Exposed for tests. */
  async refresh(): Promise<void> {
    for (const [key, handlers] of this.subscribers) {
      const [chainId, address] = key.split(':');
      const token = findToken(Number(chainId), address ?? '');
      if (!token) continue;
      try {
        const market = await this.getMarket(token);
        for (const handler of Array.from(handlers)) handler(market);
      } catch {
        // Leave the last good price on screen; staleness is shown by the UI.
      }
    }
  }

  dispose(): void {
    this.stop();
    this.subscribers.clear();
  }
}
