import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../events/bus';
import { WorkspaceStore } from '../deck/store';
import { createDeck, activeDeck } from '../deck/deckReducer';
import type { WorkspaceState } from '../deck/deckReducer';
import { MemoryAdapter } from '../storage/MemoryAdapter';
import { MODULE_TYPES } from '../../modules/definitions';

function store() {
  const deck = createDeck('HISTORY');
  const state: WorkspaceState = { decks: [deck], activeDeckId: deck.id, lastError: null };
  return new WorkspaceStore(state, new MemoryAdapter(), new EventBus(), 0);
}

describe('undo / redo', () => {
  it('restores a deleted module and all of its links', () => {
    const s = store();
    const deckId = s.getState().activeDeckId;
    s.dispatch({ type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.pairSelector });
    s.dispatch({ type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.chart });
    const [pair, chart] = s.getActiveDeck()!.modules;
    s.dispatch({
      type: 'LINK/CONNECT',
      deckId,
      source: { moduleId: pair!.id, portId: 'pair' },
      target: { moduleId: chart!.id, portId: 'pair' },
    });
    expect(s.getActiveDeck()!.connections).toHaveLength(1);

    s.dispatch({ type: 'MODULE/REMOVE', deckId, moduleId: pair!.id });
    expect(s.getActiveDeck()!.modules).toHaveLength(1);
    expect(s.getActiveDeck()!.connections).toHaveLength(0);

    expect(s.undo()).toBe(true);
    expect(s.getActiveDeck()!.modules).toHaveLength(2);
    expect(s.getActiveDeck()!.connections).toHaveLength(1);
  });

  it('redoes what was undone, and drops the redo branch on a new edit', () => {
    const s = store();
    const deckId = s.getState().activeDeckId;
    s.dispatch({ type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.gas });
    s.undo();
    expect(s.getActiveDeck()!.modules).toHaveLength(0);
    expect(s.redo()).toBe(true);
    expect(s.getActiveDeck()!.modules).toHaveLength(1);

    s.undo();
    s.dispatch({ type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.clock });
    expect(s.canRedo()).toBe(false);
    expect(s.getActiveDeck()!.modules[0]?.type).toBe(MODULE_TYPES.clock);
  });

  it('reports nothing to undo on a fresh workspace', () => {
    const s = store();
    expect(s.canUndo()).toBe(false);
    expect(s.undo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });

  it('collapses rapid edits to the same field into one step', () => {
    const s = store();
    const deckId = s.getState().activeDeckId;
    s.dispatch({ type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.notes });
    const moduleId = s.getActiveDeck()!.modules[0]!.id;
    const depthBefore = s.getHistoryDepth().past;

    for (const text of ['h', 'he', 'hex', 'hex ', 'hex p']) {
      s.dispatch({ type: 'MODULE/CONFIG', deckId, moduleId, patch: { text } });
    }
    expect(s.getHistoryDepth().past).toBe(depthBefore + 1);

    s.undo();
    expect(s.getActiveDeck()!.modules[0]!.configuration.text).toBe('');
  });

  it('keeps separate steps for edits to different modules', () => {
    const s = store();
    const deckId = s.getState().activeDeckId;
    s.dispatch({ type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.notes });
    s.dispatch({ type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.notes });
    const [a, b] = s.getActiveDeck()!.modules;
    const depth = s.getHistoryDepth().past;
    s.dispatch({ type: 'MODULE/CONFIG', deckId, moduleId: a!.id, patch: { text: 'one' } });
    s.dispatch({ type: 'MODULE/CONFIG', deckId, moduleId: b!.id, patch: { text: 'two' } });
    expect(s.getHistoryDepth().past).toBe(depth + 2);
  });

  it('does not record view-only actions', () => {
    const s = store();
    const deckId = s.getState().activeDeckId;
    s.dispatch({ type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.gas });
    const moduleId = s.getActiveDeck()!.modules[0]!.id;
    const depth = s.getHistoryDepth().past;
    s.dispatch({ type: 'MODULE/RAISE', deckId, moduleId });
    s.dispatch({ type: 'ERROR/CLEAR' });
    expect(s.getHistoryDepth().past).toBe(depth);
  });

  it('undoes a deck deletion', () => {
    const s = store();
    s.dispatch({ type: 'DECK/ADD', deck: createDeck('SECOND') });
    expect(s.getState().decks).toHaveLength(2);
    s.dispatch({ type: 'DECK/REMOVE', deckId: s.getState().activeDeckId });
    expect(s.getState().decks).toHaveLength(1);
    s.undo();
    expect(s.getState().decks).toHaveLength(2);
  });

  it('drops history when the workspace is replaced by a hydrate', async () => {
    const adapter = new MemoryAdapter();
    const s = new WorkspaceStore(
      { decks: [createDeck('A')], activeDeckId: 'x', lastError: null },
      adapter,
      new EventBus(),
      0,
    );
    s.dispatch({ type: 'DECK/ADD', deck: createDeck('B') });
    await s.flush();
    expect(s.canUndo()).toBe(true);

    const fresh = new WorkspaceStore(
      { decks: [createDeck('EMPTY')], activeDeckId: 'y', lastError: null },
      adapter,
      new EventBus(),
      0,
    );
    await fresh.hydrate();
    expect(fresh.canUndo()).toBe(false);
  });

  it('persists the state an undo restored', async () => {
    const adapter = new MemoryAdapter();
    const s = new WorkspaceStore(
      { decks: [createDeck('KEEP')], activeDeckId: 'z', lastError: null },
      adapter,
      new EventBus(),
      0,
    );
    const deckId = s.getState().activeDeckId;
    s.dispatch({ type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.clock });
    s.undo();
    await s.flush();

    const reloaded = new WorkspaceStore(
      { decks: [createDeck('OTHER')], activeDeckId: 'q', lastError: null },
      adapter,
      new EventBus(),
      0,
    );
    await reloaded.hydrate();
    expect(activeDeck(reloaded.getState())!.modules).toHaveLength(0);
  });

  it('bounds how much history it keeps', () => {
    const s = store();
    const deckId = s.getState().activeDeckId;
    for (let i = 0; i < 80; i += 1) {
      s.dispatch({ type: 'DECK/RENAME', deckId, name: `NAME ${i}` });
      vi.setSystemTime(Date.now() + 1000);
    }
    expect(s.getHistoryDepth().past).toBeLessThanOrEqual(60);
  });
});
