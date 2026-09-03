import type { Candle } from '../../core/types';

interface Entry {
  candles: Candle[];
  storedAt: number;
}

/**
 * Short-lived cache of OHLC series.
 *
 * Flipping between 1h and 4h and back refetched the whole series each time,
 * which on a rate-limited feed is three requests to see two charts. Entries are
 * keyed by feed as well as pair and timeframe, so switching between the demo,
 * on-chain and indexer feeds can never show one feed's candles under another
 * one's name.
 *
 * Deliberately small and deliberately short: a chart showing minute candles from
 * two minutes ago is wrong in a way a trader will act on.
 */
export class SeriesCache {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs = 20_000,
    private readonly maxEntries = 24,
    private readonly now: () => number = Date.now,
  ) {}

  static key(feedId: string, pairId: string, timeframe: string, limit: number): string {
    return `${feedId}|${pairId}|${timeframe}|${limit}`;
  }

  get(key: string): Candle[] | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.storedAt > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    // Re-insert so the most recently read entry is the last to be evicted.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.candles;
  }

  set(key: string, candles: Candle[]): void {
    this.entries.delete(key);
    this.entries.set(key, { candles, storedAt: this.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
