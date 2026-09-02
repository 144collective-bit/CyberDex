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
import { TIMEFRAME_SECONDS } from './MarketDataProvider';
import { findToken, tokensForChain, TOKENS } from './tokens';

/** Deterministic PRNG so demo charts are stable between renders/reloads. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const BASE_PRICES: Record<string, number> = {
  PLS: 0.0000342,
  WPLS: 0.0000342,
  HEX: 0.00412,
  eHEX: 0.0068,
  PLSX: 0.0000198,
  INC: 0.712,
  DAI: 1.0,
  USDC: 1.0,
  ETH: 3420,
};

const BASE_LIQUIDITY: Record<string, number> = {
  PLS: 42_800_000,
  WPLS: 42_800_000,
  HEX: 18_400_000,
  eHEX: 6_200_000,
  PLSX: 12_900_000,
  INC: 3_100_000,
  DAI: 9_800_000,
  USDC: 7_400_000,
  ETH: 240_000_000,
};

interface LiveState {
  price: number;
  change24hPct: number;
  change7dPct: number;
  updatedAt: number;
}

/**
 * Demo market feed.
 *
 * Prices random-walk from a seeded base so the terminal has something honest to
 * render before a live indexer is wired in. Everything it returns is flagged
 * `simulated: true` — the UI is required to label it.
 */
export class DemoMarketDataProvider implements MarketDataProvider {
  readonly id = 'demo-market';
  readonly label = 'DEMO FEED';
  readonly origin = 'demo' as const;

  private state = new Map<string, LiveState>();
  private subscribers = new Map<string, Set<(market: TokenMarket) => void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickMs: number;

  constructor(tickMs = 2500) {
    this.tickMs = tickMs;
  }

  private key(token: TokenRef): string {
    return `${token.chainId}:${token.address.toLowerCase()}`;
  }

  private ensure(token: TokenRef): LiveState {
    const key = this.key(token);
    let state = this.state.get(key);
    if (!state) {
      const rand = mulberry32(hashString(key));
      const base = BASE_PRICES[token.symbol] ?? 0.01 + rand() * 4;
      const stable = token.tags?.includes('stable');
      state = {
        price: stable ? base : base * (0.94 + rand() * 0.12),
        change24hPct: stable ? (rand() - 0.5) * 0.2 : (rand() - 0.45) * 18,
        change7dPct: stable ? (rand() - 0.5) * 0.4 : (rand() - 0.4) * 44,
        updatedAt: Date.now(),
      };
      this.state.set(key, state);
    }
    return state;
  }

  private toMarket(token: TokenRef): TokenMarket {
    const state = this.ensure(token);
    const rand = mulberry32(hashString(this.key(token)) ^ 0x9e37);
    const liquidity = BASE_LIQUIDITY[token.symbol] ?? 250_000 + rand() * 2_000_000;
    return {
      token,
      priceUsd: state.price,
      change24hPct: state.change24hPct,
      change7dPct: state.change7dPct,
      volume24hUsd: liquidity * (0.18 + rand() * 0.5),
      liquidityUsd: liquidity,
      marketCapUsd: state.price * (10_000_000 + rand() * 900_000_000_000),
      updatedAt: state.updatedAt,
      simulated: true,
    };
  }

  async listTokens(chainId: number): Promise<TokenRef[]> {
    return tokensForChain(chainId);
  }

  async getToken(chainId: number, addressOrSymbol: string): Promise<TokenRef | null> {
    return findToken(chainId, addressOrSymbol) ?? null;
  }

  async getMarket(token: TokenRef): Promise<TokenMarket> {
    return this.toMarket(token);
  }

  async getMarkets(tokens: TokenRef[]): Promise<TokenMarket[]> {
    return tokens.map((token) => this.toMarket(token));
  }

  async getOHLC(pair: PairRef, timeframe: Timeframe, limit = 160): Promise<Candle[]> {
    const seconds = TIMEFRAME_SECONDS[timeframe];
    const baseMarket = this.toMarket(pair.base);
    const quoteMarket = this.toMarket(pair.quote);
    const endPrice = quoteMarket.priceUsd > 0 ? baseMarket.priceUsd / quoteMarket.priceUsd : baseMarket.priceUsd;

    const rand = mulberry32(hashString(`${pair.id}:${timeframe}`));
    const volatility = 0.004 + rand() * 0.02;
    const now = Math.floor(Date.now() / 1000 / seconds) * seconds;

    // Walk backwards from the current price so the last candle always matches.
    const closes: number[] = new Array(limit);
    let price = endPrice;
    for (let i = limit - 1; i >= 0; i -= 1) {
      closes[i] = price;
      const drift = (rand() - 0.5) * volatility * 2;
      price = Math.max(price * (1 - drift), price * 0.2);
    }

    const candles: Candle[] = [];
    for (let i = 0; i < limit; i += 1) {
      const close = closes[i]!;
      const open = i === 0 ? close * (1 - (rand() - 0.5) * volatility) : closes[i - 1]!;
      const spread = Math.abs(close - open) + close * volatility * rand();
      const high = Math.max(open, close) + spread * rand();
      const low = Math.max(1e-12, Math.min(open, close) - spread * rand());
      candles.push({
        t: (now - (limit - 1 - i) * seconds) * 1000,
        o: open,
        h: high,
        l: low,
        c: close,
        v: baseMarket.volume24hUsd * (0.4 + rand()) * (seconds / 86400),
      });
    }
    return candles;
  }

  async getLiquidity(pair: PairRef): Promise<LiquiditySnapshot> {
    const rand = mulberry32(hashString(`liq:${pair.id}`));
    const base = this.toMarket(pair.base).liquidityUsd;
    const total = base * (0.25 + rand() * 0.5);
    const venues = [
      { dex: 'PulseX V2', share: 0.52 + rand() * 0.15 },
      { dex: 'PulseX V1', share: 0.22 + rand() * 0.1 },
      { dex: '9MM', share: 0.08 + rand() * 0.08 },
    ];
    const sum = venues.reduce((acc, v) => acc + v.share, 0);
    return {
      pair,
      totalUsd: total,
      venues: venues.map((v) => ({
        dex: v.dex,
        usd: (total * v.share) / sum,
        sharePct: (v.share / sum) * 100,
      })),
      change24hPct: (rand() - 0.45) * 12,
      updatedAt: Date.now(),
      simulated: true,
    };
  }

  async getWhaleMovements(chainId: number, limit = 12): Promise<WhaleMovement[]> {
    const tokens = tokensForChain(chainId);
    const rand = mulberry32(hashString(`whales:${chainId}:${Math.floor(Date.now() / 60000)}`));
    const out: WhaleMovement[] = [];
    for (let i = 0; i < limit; i += 1) {
      const token = tokens[Math.floor(rand() * tokens.length)] ?? tokens[0]!;
      const market = this.toMarket(token);
      const valueUsd = 25_000 + rand() * 1_400_000;
      out.push({
        id: `whale_${i}_${Math.floor(Date.now() / 60000)}`,
        wallet: `0x${Math.floor(rand() * 0xffffffff).toString(16).padStart(8, '0')}${'a3f9'.repeat(8)}`.slice(0, 42),
        direction: rand() > 0.5 ? 'IN' : 'OUT',
        token,
        amount: valueUsd / Math.max(market.priceUsd, 1e-9),
        valueUsd,
        timestamp: Date.now() - i * (60_000 + rand() * 900_000),
        hash: `0x${(hashString(`${i}${chainId}`) >>> 0).toString(16).padStart(8, '0').repeat(8)}`.slice(0, 66),
        simulated: true,
      });
    }
    return out.sort((a, b) => b.timestamp - a.timestamp);
  }

  subscribePrice(token: TokenRef, handler: (market: TokenMarket) => void): () => void {
    const key = this.key(token);
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(handler);
    handler(this.toMarket(token));
    this.start();
    return () => {
      set?.delete(handler);
      if (set && set.size === 0) this.subscribers.delete(key);
      if (this.subscribers.size === 0) this.stop();
    };
  }

  async health(): Promise<ServiceHealth> {
    return 'online';
  }

  /** Advance every subscribed token one tick. Exposed for tests. */
  tick(): void {
    for (const [key, handlers] of this.subscribers) {
      const token = TOKENS.find((tk) => `${tk.chainId}:${tk.address.toLowerCase()}` === key);
      if (!token) continue;
      const state = this.ensure(token);
      const stable = token.tags?.includes('stable');
      const drift = stable ? (Math.random() - 0.5) * 0.0004 : (Math.random() - 0.5) * 0.012;
      state.price = Math.max(state.price * (1 + drift), 1e-12);
      state.change24hPct += drift * 100 * 0.35;
      state.updatedAt = Date.now();
      const market = this.toMarket(token);
      for (const handler of Array.from(handlers)) handler(market);
    }
  }

  private start(): void {
    if (this.timer || typeof setInterval !== 'function') return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  private stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    this.subscribers.clear();
  }
}
