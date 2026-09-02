import type { PersistenceAdapter } from './PersistenceAdapter';
import { MemoryAdapter } from './MemoryAdapter';

export class LocalStorageAdapter implements PersistenceAdapter {
  readonly id = 'local-storage';
  private prefix: string;

  constructor(prefix = '') {
    this.prefix = prefix;
  }

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = window.localStorage.getItem(this.key(key));
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      // Corrupt payload or blocked storage — behave as empty rather than crash.
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      window.localStorage.setItem(this.key(key), JSON.stringify(value));
    } catch (err) {
      console.warn('[storage] write failed', err);
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
export function createDefaultAdapter(): PersistenceAdapter {
  if (typeof window !== 'undefined' && 'localStorage' in window && storageUsable()) {
    return new LocalStorageAdapter();
  }
  return new MemoryAdapter();
}
