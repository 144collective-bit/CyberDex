import { useEffect, useState, useSyncExternalStore } from 'react';
import type {
  Candle,
  PairRef,
  PortfolioSnapshot,
  Timeframe,
  TokenMarket,
  TokenRef,
  WalletRecord,
} from '../core/types';
import type { LiquiditySnapshot } from '../services/market/MarketDataProvider';
import { useSystem } from './system';
import { SeriesCache } from '../services/market/SeriesCache';

export interface AsyncValue<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Live price for one token. Subscribes only while the module is mounted. */
export function useTokenMarket(token: TokenRef | null | undefined): TokenMarket | null {
  const system = useSystem();
  const [market, setMarket] = useState<TokenMarket | null>(null);

  useEffect(() => {
    if (!token) {
      setMarket(null);
      return;
    }
    setMarket(null);
    const unsubscribe = system.market.subscribePrice(token, (next) => {
      setMarket(next);
      system.bus.emit('PRICE_UPDATED', { token, market: next }, 'market');
    });
    return unsubscribe;
  }, [system, token]);

  return market;
}

/**
 * Shared across every chart on the deck: two charts on the same pair and
 * timeframe are one request, and flipping a timeframe back and forth inside the
 * TTL costs nothing.
 */
const seriesCache = new SeriesCache();

export function useOHLC(pair: PairRef | null | undefined, timeframe: Timeframe, limit = 160): AsyncValue<Candle[]> {
  const system = useSystem();
  const [state, setState] = useState<AsyncValue<Candle[]>>({ data: null, loading: Boolean(pair), error: null });
  // The active feed is part of the cache key, so a mode change cannot serve one
  // feed's candles under another's name.
  const feedId = useSyncExternalStore(system.marketSwitch.subscribeMode, system.marketSwitch.getMode);
  const pairId = pair?.id ?? '';

  useEffect(() => {
    if (!pair) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const key = SeriesCache.key(feedId, pairId, timeframe, limit);
    const cached = seriesCache.get(key);
    if (cached) {
      setState({ data: cached, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    system.market
      .getOHLC(pair, timeframe, limit)
      .then((candles) => {
        // Only a real series is worth caching; an empty answer should be retried
        // rather than remembered for the next twenty seconds.
        if (candles.length) seriesCache.set(key, candles);
        if (!cancelled) setState({ data: candles, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ data: null, loading: false, error: err instanceof Error ? err.message : 'Series unavailable' });
        }
      });
    return () => {
      cancelled = true;
    };
    // `pair` is excluded deliberately: it is keyed by id, and a fresh object for
    // the same pair should not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system, pairId, timeframe, limit, feedId]);

  return state;
}

export function useLiquidity(pair: PairRef | null | undefined): AsyncValue<LiquiditySnapshot> {
  const system = useSystem();
  const [state, setState] = useState<AsyncValue<LiquiditySnapshot>>({
    data: null,
    loading: Boolean(pair),
    error: null,
  });

  useEffect(() => {
    if (!pair) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    system.market
      .getLiquidity(pair)
      .then((snapshot) => !cancelled && setState({ data: snapshot, loading: false, error: null }))
      .catch(
        (err: unknown) =>
          !cancelled &&
          setState({ data: null, loading: false, error: err instanceof Error ? err.message : 'No liquidity data' }),
      );
    return () => {
      cancelled = true;
    };
  }, [system, pair]);

  return state;
}

/** Portfolio for a wallet, refreshed on an interval and on balance events. */
export function usePortfolio(wallet: WalletRecord | null, chainId: number, intervalMs = 20_000): AsyncValue<PortfolioSnapshot> {
  const system = useSystem();
  const [state, setState] = useState<AsyncValue<PortfolioSnapshot>>({
    data: null,
    loading: Boolean(wallet),
    error: null,
  });

  useEffect(() => {
    if (!wallet) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;

    const load = async (force = false) => {
      try {
        const chain = system.chainFor(chainId);
        const snapshot = await system.portfolio.load(wallet.address, chain, system.market, { force });
        if (!cancelled) setState({ data: snapshot, loading: false, error: null });
      } catch (err) {
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Portfolio unavailable',
          });
        }
      }
    };

    void load();
    const timer = setInterval(() => void load(true), intervalMs);
    const off = system.bus.on('TRANSACTION_CONFIRMED', () => void load(true));
    return () => {
      cancelled = true;
      clearInterval(timer);
      off();
    };
  }, [system, wallet, chainId, intervalMs]);

  return state;
}
