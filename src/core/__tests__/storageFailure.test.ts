import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageAdapter } from '../storage/LocalStorageAdapter';
import type { StorageFailure } from '../storage/LocalStorageAdapter';
import { WorkspaceStore } from '../deck/store';
import { createDeck } from '../deck/deckReducer';
import { EventBus } from '../events/bus';

describe('LocalStorageAdapter failure handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('writes and reads through localStorage while healthy', async () => {
    const adapter = new LocalStorageAdapter();
    await adapter.set('deck', { name: 'A' });
    expect(await adapter.get<{ name: string }>('deck')).toEqual({ name: 'A' });
    expect(adapter.degraded).toBe(false);
  });

  it('reports a quota failure instead of silently dropping the write', async () => {
    const failures: StorageFailure[] = [];
    const adapter = new LocalStorageAdapter('', (failure) => failures.push(failure));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    await adapter.set('deck', { name: 'BIG' });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.degraded).toBe(true);
    expect(adapter.degraded).toBe(true);
  });

  it('keeps the session working from memory after a failure', async () => {
    const adapter = new LocalStorageAdapter();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    await adapter.set('deck', { name: 'MEMORY' });
    // The value survives in-session even though it never reached localStorage.
    expect(await adapter.get<{ name: string }>('deck')).toEqual({ name: 'MEMORY' });
  });

  it('reports the failure once, not on every subsequent write', async () => {
    const failures: StorageFailure[] = [];
    const adapter = new LocalStorageAdapter('', (failure) => failures.push(failure));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    await adapter.set('a', 1);
    await adapter.set('b', 2);
    await adapter.set('c', 3);
    expect(failures).toHaveLength(1);
  });

  it('never reports a deck as saved once storage has degraded', async () => {
    const adapter = new LocalStorageAdapter();
    const bus = new EventBus();
    const saved = vi.fn();
    const notices = vi.fn();
    bus.on('DECK_SAVED', saved);
    bus.on('SYSTEM_NOTICE', notices);

    const deck = createDeck('AT RISK');
    const store = new WorkspaceStore({ decks: [deck], activeDeckId: deck.id, lastError: null }, adapter, bus, 0);

    expect(await store.flush()).toBe(true);
    expect(saved).toHaveBeenCalledTimes(1);

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(await store.flush()).toBe(false);
    // Still one — the failed save must not announce itself as a success.
    expect(saved).toHaveBeenCalledTimes(1);
    expect(notices).toHaveBeenCalled();
  });

  it('survives a corrupt stored payload on read', async () => {
    const adapter = new LocalStorageAdapter();
    window.localStorage.setItem('broken', '{not json');
    expect(await adapter.get('broken')).toBeNull();
  });
});
