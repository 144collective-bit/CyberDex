import { describe, expect, it } from 'vitest';
import type { Candle } from '../../core/types';
import { SeriesCache } from '../market/SeriesCache';

const series = (n: number): Candle[] => [{ t: n, o: n, h: n, l: n, c: n, v: n }];

describe('SeriesCache', () => {
  it('returns what was stored', () => {
    const cache = new SeriesCache();
    cache.set('a', series(1));
    expect(cache.get('a')).toEqual(series(1));
  });

  it('misses on an unknown key', () => {
    expect(new SeriesCache().get('nothing')).toBeNull();
  });

  it('expires an entry once the TTL has passed', () => {
    let now = 1000;
    const cache = new SeriesCache(20_000, 24, () => now);
    cache.set('a', series(1));
    now += 19_999;
    expect(cache.get('a')).toEqual(series(1));
    now += 2;
    expect(cache.get('a')).toBeNull();
  });

  it('drops the expired entry rather than keeping it around', () => {
    let now = 0;
    const cache = new SeriesCache(10, 24, () => now);
    cache.set('a', series(1));
    now = 100;
    cache.get('a');
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry past the size bound', () => {
    const cache = new SeriesCache(60_000, 3);
    cache.set('a', series(1));
    cache.set('b', series(2));
    cache.set('c', series(3));
    // Touching 'a' makes 'b' the oldest.
    cache.get('a');
    cache.set('d', series(4));
    expect(cache.size).toBe(3);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).toEqual(series(1));
    expect(cache.get('d')).toEqual(series(4));
  });

  it('keys by feed, so one feed cannot serve another feed candles', () => {
    const demo = SeriesCache.key('demo-market', 'pls/hex', '1h', 160);
    const chain = SeriesCache.key('pulsechain-market', 'pls/hex', '1h', 160);
    expect(demo).not.toBe(chain);
  });

  it('keys by pair, timeframe and limit', () => {
    const base = SeriesCache.key('demo', 'a/b', '1h', 160);
    expect(SeriesCache.key('demo', 'c/d', '1h', 160)).not.toBe(base);
    expect(SeriesCache.key('demo', 'a/b', '4h', 160)).not.toBe(base);
    expect(SeriesCache.key('demo', 'a/b', '1h', 80)).not.toBe(base);
  });

  it('replaces rather than duplicates on a repeat write', () => {
    const cache = new SeriesCache();
    cache.set('a', series(1));
    cache.set('a', series(2));
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toEqual(series(2));
  });

  it('clears everything', () => {
    const cache = new SeriesCache();
    cache.set('a', series(1));
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
