import type { PersistenceAdapter } from './PersistenceAdapter';
import { MemoryAdapter } from './MemoryAdapter';

export type StorageFailure = {
  key: string;
  message: string;
  /** True once writes have fallen back to memory for the rest of the session. */
  degraded: boolean;
};

export class LocalStorageAdapter implements PersistenceAdapter {
  readonly id = 'local-storage';
  private prefix: string;
  private onFailure?: (failure: StorageFailure) => void;
  /** Set once a write fails; every later write goes to memory instead. */
  private fallback: MemoryAdapter | null = null;

  constructor(prefix = '', onFailure?: (failure: StorageFailure) => void) {
    this.prefix = prefix;
    this.onFailure = onFailure;
  }

  /** True when persistence has silently degraded to this session only. */
  get degraded(): boolean {
    return this.fallback !== null;
  }

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.fallback) {
      const held = await this.fallback.get<T>(key);
      if (held !== null) return held;
    }
    try {
      const raw = window.localStorage.getItem(this.key(key));
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      // Corrupt payload or blocked storage — behave as empty rather than crash.
      return null;
    }
  }

  /**
   * A failed write is reported, not swallowed.
   *
   * Quota exhaustion and private-browsing blocks both land here. The value is
   * kept in memory so the session keeps working, and the caller is told once
   * that persistence has degraded — the user must never believe a deck is saved
   * when it is not.
   */
  async set<T>(key: string, value: T): Promise<void> {
    if (this.fallback) {
      await this.fallback.set(key, value);
      return;
    }
    try {
      window.localStorage.setItem(this.key(key), JSON.stringify(value));
    } catch (err) {
      this.fallback = new MemoryAdapter();
      await this.fallback.set(key, value);
      const message = err instanceof Error ? err.message : 'Storage write rejected';
      console.warn('[storage] write failed, falling back to memory', err);
      this.onFailure?.({ key, message, degraded: true });
    }
  }

  async remove(key: string): Promise<void> {
    try {
      window.localStorage.removeItem(this.key(key));
    } catch {
      /* ignore */
    }
  }

  async keys(): Promise<string[]> {
    try {
      return Object.keys(window.localStorage).filter((k) => k.startsWith(this.prefix));
    } catch {
      return [];
    }
  }
}

function storageUsable(): boolean {
  try {
    const probe = '__cyberdex_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Picks the best adapter available in this environment. */
export function createDefaultAdapter(onFailure?: (failure: StorageFailure) => void): PersistenceAdapter {
  if (typeof window !== 'undefined' && 'localStorage' in window && storageUsable()) {
    return new LocalStorageAdapter('', onFailure);
  }
  // No usable Storage at all (private mode, embedded webview): say so up front
  // rather than letting the user discover it after losing a deck.
  onFailure?.({
    key: '*',
    message: 'This browser is not allowing local storage. Decks last only for this session.',
    degraded: true,
  });
  return new MemoryAdapter();
}
