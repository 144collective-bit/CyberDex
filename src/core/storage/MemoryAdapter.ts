import type { PersistenceAdapter } from './PersistenceAdapter';

/** Used by tests and by any environment without a usable Storage object. */
export class MemoryAdapter implements PersistenceAdapter {
  readonly id = 'memory';
  private store = new Map<string, string>();

  async get<T>(key: string): Promise<T | null> {
    const raw = this.store.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }
}
