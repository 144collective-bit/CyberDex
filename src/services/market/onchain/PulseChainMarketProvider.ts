import type {
  Candle,
  PairRef,
  ServiceHealth,
  Timeframe,
  TokenMarket,
  TokenRef,
  WhaleMovement,
} from '../../../core/types';
import type { LiquiditySnapshot, MarketDataProvider } from '../MarketDataProvider';
import { JsonRpcClient } from '../../chain/JsonRpcClient';
import type { EndpointHealth } from '../../chain/JsonRpcClient';
import { decodeAddress, decodeReserves, encodeGetPair, encodeGetReserves } from '../../chain/abi';
import { getChainMarketConfig } from '../../chain/chainConfig';
import type { ChainMarketConfig } from '../../chain/chainConfig';
import { findToken, tokensForChain } from '../tokens';
import { deepestPool, poolLiquidityUsd, priceInPool, toPoolSnapshot, usdPrice } from './priceMath';
import type { PoolSnapshot } from './priceMath';

interface PairLookup {
  address: string | null;
  factory: string;
}

/**
 * Market data read straight from PulseChain.
 *
 * Prices come from AMM reserves, which is the same state the router trades
 * against — there is no fresher or more authoritative source. Every read in a
 * refresh is pinned to one block number, so a set of prices is a coherent
 * snapshot rather than a handful of moments stitched together.
 *
 * What the chain cannot give cheaply is history: candles and 24h aggregates
 * need an indexer, so `getOHLC` returns nothing and the chart module shows its
 * empty state rather than inventing a series.
 */
export class PulseChainMarketProvider implements MarketDataProvider {
  readonly id = 'pulsechain-onchain';
  readonly label = 'ON-CHAIN';
  readonly origin = 'live' as const;

  private rpc: JsonRpcClient;
  private config: ChainMarketConfig;
  private pollMs: number;

  /** token pair → pair contract, cached: a deployed pair address is immutable. */
  private pairCache = new Map<string, PairLookup>();
  private tokenOrder = new Map<string, { token0: string; token1: string }>();
  private lastMarket = new Map<string, TokenMarket>();
  private subscribers = new Map<string, Set<(market: TokenMarket) => void>>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: { chainId?: number; rpc?: JsonRpcClient; pollMs?: number } = {}) {
    const chainId = options.chainId ?? 369;
    const config = getChainMarketConfig(chainId);
    if (!config) throw new Error(`No on-chain market configuration for chain ${chainId}`);
    this.config = config;
    this.rpc = options.rpc ?? new JsonRpcClient({ endpoints: config.rpcEndpoints });
    this.pollMs = options.pollMs ?? 12_000;
  }

  getEndpointHealth(): EndpointHealth[] {
    return this.rpc.getHealth();
  }

  private addressOf(token: TokenRef): string {
    return token.address === 'native' ? this.config.wrappedNative : token.address;
  }

  private pairKey(a: string, b: string): string {
    return [a.toLowerCase(), b.toLowerCase()].sort().join('/');
  }

  /** Resolve the pair contract for two tokens across the configured factories. */
  private async resolvePair(tokenA: string, tokenB: string, block: string): Promise<PairLookup> {
    const key = this.pairKey(tokenA, tokenB);
    const cached = this.pairCache.get(key);
    if (cached) return cached;

    const calls = this.config.factories.map((factory) => ({
      to: factory.address,
      data: encodeGetPair(tokenA, tokenB),
    }));
    const results = await this.rpc.callMany(calls, block);

    let found: PairLookup = { address: null, factory: '' };
    results.forEach((hex, index) => {
      if (found.address || !hex) return;
      const address = decodeAddress(hex);
      if (address) found = { address, factory: this.config.factories[index]!.label };
    });

    this.pairCache.set(key, found);
    return found;
  }

  /** Read reserves and token ordering for a set of pair contracts. */
  private async loadPools(
    pairs: { address: string; tokenA: string; tokenB: string; decimalsA: number; decimalsB: number }[],
    block: string,
  ): Promise<Map<string, PoolSnapshot>> {
    const out = new Map<string, PoolSnapshot>();
    if (!pairs.length) return out;

    // token0/token1 ordering is fixed at deployment, so it is read once.
    const unknown = pairs.filter((pair) => !this.tokenOrder.has(pair.address.toLowerCase()));
    if (unknown.length) {
      const calls = unknown.flatMap((pair) => [
        { to: pair.address, data: '0x0dfe1681' }, // token0()
        { to: pair.address, data: '0xd21220a7' }, // token1()
      ]);
      const results = await this.rpc.callMany(calls, block);
      unknown.forEach((pair, index) => {
        const token0 = results[index * 2] ? decodeAddress(results[index * 2]!) : null;
        const token1 = results[index * 2 + 1] ? decodeAddress(results[index * 2 + 1]!) : null;
        if (token0 && token1) this.tokenOrder.set(pair.address.toLowerCase(), { token0, token1 });
      });
    }

    const reserveResults = await this.rpc.callMany(
      pairs.map((pair) => ({ to: pair.address, data: encodeGetReserves() })),
      block,
    );

    pairs.forEach((pair, index) => {
      const hex = reserveResults[index];
      const order = this.tokenOrder.get(pair.address.toLowerCase());
      if (!hex || !order) return;
      const reserves = decodeReserves(hex);
      if (!reserves) return;
      const aIsToken0 = order.token0.toLowerCase() === pair.tokenA.toLowerCase();
      out.set(
        pair.address.toLowerCase(),
        toPoolSnapshot(
          pair.address,
          order.token0,
          order.token1,
          reserves,
          aIsToken0 ? pair.decimalsA : pair.decimalsB,
          aIsToken0 ? pair.decimalsB : pair.decimalsA,
        ),
      );
    });

    return out;
  }

  /** USD price of the wrapped native token, from the deepest stable pool. */
  private async nativeUsd(block: string): Promise<number | null> {
    const wrapped = this.config.wrappedNative;
    const candidates = await Promise.all(
      this.config.stables.map(async (stable) => {
        const pair = await this.resolvePair(wrapped, stable.address, block);
        return pair.address ? { pair: pair.address, stable } : null;
      }),
    );
    const usable = candidates.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (!usable.length) return null;

    const pools = await this.loadPools(
      usable.map((entry) => ({
        address: entry.pair,
        tokenA: wrapped,
        tokenB: entry.stable.address,
        decimalsA: this.config.nativeDecimals,
        decimalsB: entry.stable.decimals,
      })),
      block,
    );

    const snapshots = Array.from(pools.values());
    const deepest = deepestPool(snapshots, wrapped);
    if (!deepest) return null;
    return priceInPool(deepest, wrapped);
  }

  async listTokens(chainId: number): Promise<TokenRef[]> {
    return tokensForChain(chainId);
  }

  async getToken(chainId: number, addressOrSymbol: string): Promise<TokenRef | null> {
    return findToken(chainId, addressOrSymbol) ?? null;
  }

  async getMarket(token: TokenRef): Promise<TokenMarket> {
    const [market] = await this.getMarkets([token]);
    if (!market) throw new Error(`No on-chain price for ${token.symbol}`);
    return market;
  }

  /**
   * Price a set of tokens in one pinned-block pass.
   *
   * A deck showing eight tokens costs a handful of batched requests, not one
   * request per token per refresh.
   */
  async getMarkets(tokens: TokenRef[]): Promise<TokenMarket[]> {
    if (!tokens.length) return [];
    const blockNumber = await this.rpc.blockNumber();
    const block = `0x${blockNumber.toString(16)}`;
    const at = Date.now();

    const nativeUsdPrice = await this.nativeUsd(block);
    const wrapped = this.config.wrappedNative;

    // Resolve the pools each token can be priced from: native, then stables.
    const routes = await Promise.all(
      tokens.map(async (token) => {
        const address = this.addressOf(token);
        const nativePair =
          address.toLowerCase() === wrapped.toLowerCase() ? null : await this.resolvePair(address, wrapped, block);
        const stable = this.config.stables[0]!;
        const stablePair =
          address.toLowerCase() === stable.address.toLowerCase()
            ? null
            : await this.resolvePair(address, stable.address, block);
        return { token, address, nativePair, stablePair, stable };
      }),
    );

    const poolRequests = routes.flatMap((route) => {
      const entries: { address: string; tokenA: string; tokenB: string; decimalsA: number; decimalsB: number }[] = [];
      if (route.nativePair?.address) {
        entries.push({
          address: route.nativePair.address,
          tokenA: route.address,
          tokenB: wrapped,
          decimalsA: route.token.decimals,
          decimalsB: this.config.nativeDecimals,
        });
      }
      if (route.stablePair?.address) {
        entries.push({
          address: route.stablePair.address,
          tokenA: route.address,
          tokenB: route.stable.address,
          decimalsA: route.token.decimals,
          decimalsB: route.stable.decimals,
        });
      }
      return entries;
    });

    const pools = await this.loadPools(poolRequests, block);

    return routes.map((route) => {
      const nativePool = route.nativePair?.address ? pools.get(route.nativePair.address.toLowerCase()) ?? null : null;
      const stablePool = route.stablePair?.address ? pools.get(route.stablePair.address.toLowerCase()) ?? null : null;

      const price =
        usdPrice({
          token: route.address,
          directStablePool: stablePool,
          nativePool,
          nativeUsd: nativeUsdPrice,
          wrappedNative: wrapped,
        }) ?? 0;

      const liquidityUsd = [nativePool, stablePool].reduce((acc, pool) => {
        if (!pool) return acc;
        const isToken0 = pool.token0.toLowerCase() === route.address.toLowerCase();
        return (
          acc +
          poolLiquidityUsd(pool, {
            token0: isToken0 ? price : undefined,
            token1: isToken0 ? undefined : price,
          })
        );
      }, 0);

      const previous = this.lastMarket.get(this.key(route.token));
      const market: TokenMarket = {
        token: route.token,
        priceUsd: price,
        // Change and volume are windowed aggregates: an indexer's job, not a
        // reserve read. Reported as zero rather than guessed.
        change24hPct: previous && previous.priceUsd > 0 ? ((price - previous.priceUsd) / previous.priceUsd) * 100 : 0,
        change7dPct: 0,
        volume24hUsd: 0,
        liquidityUsd,
        marketCapUsd: 0,
        updatedAt: at,
        simulated: false,
      };
      this.lastMarket.set(this.key(route.token), market);
      return market;
    });
  }

  private key(token: TokenRef): string {
    return `${token.chainId}:${token.address.toLowerCase()}`;
  }

  /** History needs an indexer; the chart shows its empty state instead. */
  async getOHLC(_pair: PairRef, _timeframe: Timeframe, _limit?: number): Promise<Candle[]> {
    return [];
  }

  async getLiquidity(pair: PairRef): Promise<LiquiditySnapshot> {
    const blockNumber = await this.rpc.blockNumber();
    const block = `0x${blockNumber.toString(16)}`;
    const baseAddress = this.addressOf(pair.base);
    const quoteAddress = this.addressOf(pair.quote);

    const venues: { dex: string; usd: number }[] = [];
    const [baseMarket] = await this.getMarkets([pair.base]);
    const basePrice = baseMarket?.priceUsd ?? 0;

    for (const factory of this.config.factories) {
      const results = await this.rpc.callMany(
        [{ to: factory.address, data: encodeGetPair(baseAddress, quoteAddress) }],
        block,
      );
      const address = results[0] ? decodeAddress(results[0]!) : null;
      if (!address) continue;
      const pools = await this.loadPools(
        [
          {
            address,
            tokenA: baseAddress,
            tokenB: quoteAddress,
            decimalsA: pair.base.decimals,
            decimalsB: pair.quote.decimals,
          },
        ],
        block,
      );
      const pool = pools.get(address.toLowerCase());
      if (!pool) continue;
      const isToken0 = pool.token0.toLowerCase() === baseAddress.toLowerCase();
      venues.push({
        dex: factory.label,
        usd: poolLiquidityUsd(pool, {
          token0: isToken0 ? basePrice : undefined,
          token1: isToken0 ? undefined : basePrice,
        }),
      });
    }

    const totalUsd = venues.reduce((acc, venue) => acc + venue.usd, 0);
    return {
      pair,
      totalUsd,
      venues: venues.map((venue) => ({
        ...venue,
        sharePct: totalUsd > 0 ? (venue.usd / totalUsd) * 100 : 0,
      })),
      change24hPct: 0,
      updatedAt: Date.now(),
      simulated: false,
    };
  }

  /** Wallet-level flow needs log indexing; not available from reserve reads. */
  async getWhaleMovements(): Promise<WhaleMovement[]> {
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

  /** Re-price every subscribed token in one pinned-block pass. */
  async refresh(): Promise<void> {
    const tokens: TokenRef[] = [];
    for (const key of this.subscribers.keys()) {
      const [chainId, address] = key.split(':');
      const token = findToken(Number(chainId), address ?? '');
      if (token) tokens.push(token);
    }
    if (!tokens.length) return;
    try {
      const markets = await this.getMarkets(tokens);
      markets.forEach((market) => {
        const handlers = this.subscribers.get(this.key(market.token));
        if (!handlers) return;
        for (const handler of Array.from(handlers)) handler(market);
      });
    } catch {
      // Leave the last good prices on screen; the UI marks them stale.
    }
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

  async health(): Promise<ServiceHealth> {
    try {
      await this.rpc.blockNumber();
      // Measure against the endpoints this client actually holds, not the
      // configured list — they differ whenever one is injected.
      const endpoints = this.rpc.getHealth();
      const healthy = endpoints.filter((endpoint) => endpoint.healthy).length;
      if (healthy === 0) return 'offline';
      return healthy < endpoints.length ? 'degraded' : 'online';
    } catch {
      return 'offline';
    }
  }

  dispose(): void {
    this.stop();
    this.subscribers.clear();
  }
}
