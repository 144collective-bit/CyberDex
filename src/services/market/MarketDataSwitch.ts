import type {
  Candle,
  DataOrigin,
  PairRef,
  ServiceHealth,
  Timeframe,
  TokenMarket,
  TokenRef,
  WhaleMovement,
} from '../../core/types';
import type { LiquiditySnapshot, MarketDataProvider } from './MarketDataProvider';

export type FeedMode = 'demo' | 'live';

/**
 * Runtime choice between the demo feed and the live one.
 *
 * Modules hold a reference to this object for the life of the session, so
 * flipping the source in Settings takes effect everywhere without any module
 * re-subscribing or knowing that a switch exists.
 */
export class MarketDataSwitch implements MarketDataProvider {
  private demo: MarketDataProvider;
  private live: MarketDataProvider;
  private mode: FeedMode = 'demo';
  private listeners = new Set<() => void>();

  constructor(demo: MarketDataProvider, live: MarketDataProvider) {
    this.demo = demo;
    this.live = live;
  }

  private get active(): MarketDataProvider {
    return this.mode === 'live' ? this.live : this.demo;
  }

  get id(): string {
    return this.active.id;
  }

  get label(): string {
    return this.active.label;
  }

  get origin(): DataOrigin {
    return this.active.origin;
  }

  getMode = (): FeedMode => this.mode;

  subscribeMode = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setMode(mode: FeedMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    for (const listener of Array.from(this.listeners)) listener();
  }

  /** The live provider, for status displays that need its detail. */
  getLiveProvider(): MarketDataProvider {
    return this.live;
  }

  listTokens(chainId: number): Promise<TokenRef[]> {
    return this.active.listTokens(chainId);
  }
  getToken(chainId: number, addressOrSymbol: string): Promise<TokenRef | null> {
    return this.active.getToken(chainId, addressOrSymbol);
  }
  getMarket(token: TokenRef): Promise<TokenMarket> {
    return this.active.getMarket(token);
  }
  getMarkets(tokens: TokenRef[]): Promise<TokenMarket[]> {
    return this.active.getMarkets(tokens);
  }
  getOHLC(pair: PairRef, timeframe: Timeframe, limit?: number): Promise<Candle[]> {
    return this.active.getOHLC(pair, timeframe, limit);
  }
  getLiquidity(pair: PairRef): Promise<LiquiditySnapshot> {
    return this.active.getLiquidity(pair);
  }
  getWhaleMovements(chainId: number, limit?: number): Promise<WhaleMovement[]> {
    return this.active.getWhaleMovements(chainId, limit);
  }
  subscribePrice(token: TokenRef, handler: (market: TokenMarket) => void): () => void {
    return this.active.subscribePrice(token, handler);
  }
  health(): Promise<ServiceHealth> {
    return this.active.health();
  }
}
