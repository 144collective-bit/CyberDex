import type { EventBus } from '../../core/events/bus';
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

export interface FeedStatus {
  /** Which provider actually answered most recently. */
  activeId: string;
  origin: DataOrigin;
  usingFallback: boolean;
  lastError: string | null;
  lastSuccessAt: number;
  consecutiveFailures: number;
}

/**
 * Wraps a live provider with the demo feed as a safety net.
 *
 * A public API will rate-limit, drift or go down. When that happens the deck
 * must keep working, and the user must be told which data they are looking at —
 * so a fallback flips `origin` to 'demo', which every module already renders as
 * a DEMO badge, and raises one notice rather than one per failed call.
 */
export class ResilientMarketProvider implements MarketDataProvider {
  readonly id: string;
  readonly label: string;

  private primary: MarketDataProvider;
  private fallback: MarketDataProvider;
  private bus: EventBus;
  private status: FeedStatus;
  private listeners = new Set<() => void>();
  /** Failures in a row before the feed is declared down. */
  private tolerance: number;
  /** How often a subscribed price is re-fetched from the live feed. */
  private pollMs: number;

  constructor(
    primary: MarketDataProvider,
    fallback: MarketDataProvider,
    bus: EventBus,
    options: { tolerance?: number; pollMs?: number } = {},
  ) {
    this.primary = primary;
    this.fallback = fallback;
    this.bus = bus;
    this.tolerance = options.tolerance ?? 2;
    this.pollMs = options.pollMs ?? 15_000;
    this.id = primary.id;
    this.label = primary.label;
    this.status = {
      activeId: primary.id,
      origin: primary.origin,
      usingFallback: false,
      lastError: null,
      lastSuccessAt: 0,
      consecutiveFailures: 0,
    };
  }

  /** Modules read this to label their data honestly. */
  get origin(): DataOrigin {
    return this.status.usingFallback ? this.fallback.origin : this.primary.origin;
  }

  getStatus = (): FeedStatus => this.status;

  subscribeStatus = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setStatus(patch: Partial<FeedStatus>): void {
    const next = { ...this.status, ...patch };
    if (
      next.usingFallback === this.status.usingFallback &&
      next.lastError === this.status.lastError &&
      next.consecutiveFailures === this.status.consecutiveFailures &&
      next.lastSuccessAt === this.status.lastSuccessAt
    ) {
      return;
    }
    this.status = next;
    for (const listener of Array.from(this.listeners)) listener();
  }

  /** Run against the primary, falling back once it has failed enough times. */
  private async run<T>(operation: (provider: MarketDataProvider) => Promise<T>): Promise<T> {
    if (this.status.usingFallback) return operation(this.fallback);
    try {
      const result = await operation(this.primary);
      if (this.status.consecutiveFailures > 0 || this.status.lastError) {
        this.setStatus({ consecutiveFailures: 0, lastError: null, lastSuccessAt: Date.now() });
      } else {
        this.setStatus({ lastSuccessAt: Date.now() });
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failures = this.status.consecutiveFailures + 1;
      if (failures >= this.tolerance) {
        const alreadyDown = this.status.usingFallback;
        this.setStatus({
          consecutiveFailures: failures,
          lastError: message,
          usingFallback: true,
          activeId: this.fallback.id,
          origin: this.fallback.origin,
        });
        if (!alreadyDown) {
          this.bus.emit(
            'SYSTEM_NOTICE',
            {
              level: 'warning',
              message: `LIVE FEED UNAVAILABLE (${message}) — showing simulated data until it recovers.`,
            },
            'market-feed',
          );
        }
        return operation(this.fallback);
      }
      this.setStatus({ consecutiveFailures: failures, lastError: message });
      return operation(this.fallback);
    }
  }

  /** Probe the primary and switch back when it answers again. */
  async recheck(): Promise<boolean> {
    if (!this.status.usingFallback) return true;
    const health = await this.primary.health().catch(() => 'offline' as ServiceHealth);
    if (health !== 'online') return false;
    this.setStatus({
      usingFallback: false,
      activeId: this.primary.id,
      origin: this.primary.origin,
      consecutiveFailures: 0,
      lastError: null,
      lastSuccessAt: Date.now(),
    });
    this.bus.emit('SYSTEM_NOTICE', { level: 'info', message: 'LIVE FEED RESTORED.' }, 'market-feed');
    return true;
  }

  listTokens(chainId: number): Promise<TokenRef[]> {
    return this.run((provider) => provider.listTokens(chainId));
  }

  getToken(chainId: number, addressOrSymbol: string): Promise<TokenRef | null> {
    return this.run((provider) => provider.getToken(chainId, addressOrSymbol));
  }

  getMarket(token: TokenRef): Promise<TokenMarket> {
    return this.run((provider) => provider.getMarket(token));
  }

  getMarkets(tokens: TokenRef[]): Promise<TokenMarket[]> {
    return this.run((provider) => provider.getMarkets(tokens));
  }

  getOHLC(pair: PairRef, timeframe: Timeframe, limit?: number): Promise<Candle[]> {
    return this.run((provider) => provider.getOHLC(pair, timeframe, limit));
  }

  getLiquidity(pair: PairRef): Promise<LiquiditySnapshot> {
    return this.run((provider) => provider.getLiquidity(pair));
  }

  getWhaleMovements(chainId: number, limit?: number): Promise<WhaleMovement[]> {
    return this.run((provider) => provider.getWhaleMovements(chainId, limit));
  }

  /**
   * Price updates for one token.
   *
   * While the primary is healthy this polls it through `getMarket`, so a run of
   * failures trips the same fallback as every other call. On the fallback it
   * hands over to the demo feed's own ticker, which keeps prices moving. The
   * wiring is rebuilt whenever the feed flips, so a module never re-subscribes.
   */
  subscribePrice(token: TokenRef, handler: (market: TokenMarket) => void): () => void {
    let disposed = false;
    let teardown: (() => void) | null = null;
    let wiredToFallback: boolean | null = null;

    const wire = () => {
      if (disposed) return;
      const useFallback = this.status.usingFallback;
      if (wiredToFallback === useFallback) return;
      wiredToFallback = useFallback;
      teardown?.();

      if (useFallback) {
        teardown = this.fallback.subscribePrice(token, handler);
        return;
      }

      let cancelled = false;
      const tick = async () => {
        try {
          const market = await this.getMarket(token);
          if (!cancelled) handler(market);
        } catch {
          // getMarket already recorded the failure and served the fallback.
        }
      };
      void tick();
      const timer = typeof setInterval === 'function' ? setInterval(() => void tick(), this.pollMs) : null;
      teardown = () => {
        cancelled = true;
        if (timer) clearInterval(timer);
      };
    };

    wire();
    const offStatus = this.subscribeStatus(wire);

    return () => {
      disposed = true;
      offStatus();
      teardown?.();
    };
  }

  async health(): Promise<ServiceHealth> {
    if (this.status.usingFallback) return 'degraded';
    return this.primary.health();
  }
}
