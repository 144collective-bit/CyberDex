import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../events/bus';
import { WorkspaceStore } from '../deck/store';
import { createDeck, deckReducer } from '../deck/deckReducer';
import type { WorkspaceState } from '../deck/deckReducer';
import { MemoryAdapter } from '../storage/MemoryAdapter';
import { STORAGE_KEYS } from '../storage/PersistenceAdapter';
import { exportDeck, importDeck, serializeDeck } from '../deck/schema';
import { MODULE_TYPES } from '../../modules/definitions';

function seed(): WorkspaceState {
  const deck = createDeck('PERSISTED');
  return { decks: [deck], activeDeckId: deck.id, lastError: null };
}

describe('WorkspaceStore persistence', () => {
  it('writes the workspace through the adapter and reads it back', async () => {
    const adapter = new MemoryAdapter();
    const store = new WorkspaceStore(seed(), adapter, new EventBus(), 0);
    store.dispatch({ type: 'MODULE/ADD', deckId: store.getState().activeDeckId, moduleType: MODULE_TYPES.price });
    await store.flush();

    const restored = new WorkspaceStore(seed(), adapter, new EventBus(), 0);
    const hydrated = await restored.hydrate();
    expect(hydrated).toBe(true);
    expect(restored.getActiveDeck()?.name).toBe('PERSISTED');
    expect(restored.getActiveDeck()?.modules).toHaveLength(1);
  });

  it('reports no stored workspace on a first run', async () => {
    const store = new WorkspaceStore(seed(), new MemoryAdapter(), new EventBus(), 0);
    expect(await store.hydrate()).toBe(false);
  });

  it('survives a corrupt stored payload', async () => {
    const adapter = new MemoryAdapter();
    await adapter.set(STORAGE_KEYS.workspace, { version: 1, decks: [{ nonsense: true }], activeDeckId: 'x' });
    const store = new WorkspaceStore(seed(), adapter, new EventBus(), 0);
    expect(await store.hydrate()).toBe(false);
    expect(store.getActiveDeck()?.name).toBe('PERSISTED');
  });

  it('reports a pending debounced write so callers can flush before unload', async () => {
    const store = new WorkspaceStore(seed(), new MemoryAdapter(), new EventBus(), 400);
    expect(store.hasPendingWrite()).toBe(false);
    store.dispatch({ type: 'MODULE/ADD', deckId: store.getState().activeDeckId, moduleType: MODULE_TYPES.gas });
    expect(store.hasPendingWrite()).toBe(true);
    await store.flush();
    expect(store.hasPendingWrite()).toBe(false);
  });

  it('notifies subscribers on change and emits module events', () => {
    const bus = new EventBus();
    const store = new WorkspaceStore(seed(), new MemoryAdapter(), bus, 0);
    const listener = vi.fn();
    const added = vi.fn();
    store.subscribe(listener);
    bus.on('MODULE_ADDED', added);
    store.dispatch({ type: 'MODULE/ADD', deckId: store.getState().activeDeckId, moduleType: MODULE_TYPES.gas });
    expect(listener).toHaveBeenCalled();
    expect(added).toHaveBeenCalledTimes(1);
  });

  it('does not notify when an action changes nothing', () => {
    const store = new WorkspaceStore(seed(), new MemoryAdapter(), new EventBus(), 0);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: 'DECK/RENAME', deckId: store.getState().activeDeckId, name: 'PERSISTED' });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('deck import/export', () => {
  function deckWithLink() {
    let state = seed();
    const deckId = state.activeDeckId;
    state = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.pairSelector });
    state = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.chart });
    const [pair, chart] = state.decks[0]!.modules;
    state = deckReducer(state, {
      type: 'LINK/CONNECT',
      deckId,
      source: { moduleId: pair!.id, portId: 'pair' },
      target: { moduleId: chart!.id, portId: 'pair' },
    });
    return state.decks[0]!;
  }

  it('round-trips a deck through JSON', () => {
    const deck = deckWithLink();
    const result = importDeck(serializeDeck(deck));
    expect(result.ok).toBe(true);
    expect(result.deck?.modules).toHaveLength(2);
    expect(result.deck?.connections).toHaveLength(1);
    expect(result.deck?.name).toBe(deck.name);
  });

  it('rewires links when importing with fresh ids', () => {
    const deck = deckWithLink();
    const result = importDeck(exportDeck(deck), { freshIds: true });
    const imported = result.deck!;
    const link = imported.connections[0]!;
    expect(imported.modules.some((m) => m.id === link.sourceModuleId)).toBe(true);
    expect(imported.modules.some((m) => m.id === link.targetModuleId)).toBe(true);
    expect(imported.modules.map((m) => m.id)).not.toContain(deck.modules[0]!.id);
  });

  it('drops unknown module types with a warning instead of failing', () => {
    const deck = deckWithLink();
    const payload = exportDeck(deck) as unknown as { deck: { modules: unknown[] } };
    payload.deck.modules.push({ id: 'ghost', type: 'from-the-future', position: { x: 0, y: 0 } });
    const result = importDeck(payload);
    expect(result.ok).toBe(true);
    expect(result.deck?.modules).toHaveLength(2);
    expect(result.warnings.join(' ')).toMatch(/from-the-future/);
  });

  it('migrates an older module version and backfills new config keys', () => {
    const deck = deckWithLink();
    const payload = JSON.parse(serializeDeck(deck)) as {
      deck: { modules: { version: string; configuration: Record<string, unknown> }[] };
    };
    payload.deck.modules[0]!.version = '0.9.0';
    payload.deck.modules[0]!.configuration = {};
    const result = importDeck(payload);
    expect(result.deck?.modules[0]?.version).toBe('1.0.0');
    expect(result.deck?.modules[0]?.configuration.baseSymbol).toBe('HEX');
    expect(result.warnings.join(' ')).toMatch(/migrated 0\.9\.0/);
  });

  it('rejects an incompatible deck format', () => {
    const result = importDeck({ version: '9.0', deck: { name: 'X', modules: [] } });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Unsupported deck format/);
  });

  it('rejects malformed JSON', () => {
    const result = importDeck('{not json');
    expect(result.ok).toBe(false);
  });
});
