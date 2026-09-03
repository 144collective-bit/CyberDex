import { beforeEach, describe, expect, it } from 'vitest';
import { createDeck, deckReducer, activeDeck } from '../deck/deckReducer';
import type { WorkspaceState } from '../deck/deckReducer';
import { MODULE_TYPES } from '../../modules/definitions';

function baseState(): WorkspaceState {
  const deck = createDeck('TEST DECK');
  return { decks: [deck], activeDeckId: deck.id, lastError: null };
}

describe('deckReducer — modules', () => {
  let state: WorkspaceState;
  let deckId: string;

  beforeEach(() => {
    state = baseState();
    deckId = state.activeDeckId;
  });

  it('adds a module with its definition defaults', () => {
    const next = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.price });
    const deck = activeDeck(next)!;
    expect(deck.modules).toHaveLength(1);
    expect(deck.modules[0]?.type).toBe(MODULE_TYPES.price);
    expect(deck.modules[0]?.version).toBe('1.0.0');
    expect(deck.modules[0]?.size.width).toBeGreaterThan(0);
  });

  it('refuses an unknown module type and records why', () => {
    const next = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: 'not-a-module' });
    expect(activeDeck(next)!.modules).toHaveLength(0);
    expect(next.lastError).toMatch(/Unknown module type/);
  });

  it('snaps movement to the grid and clamps to the canvas', () => {
    let next = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.gas });
    const moduleId = activeDeck(next)!.modules[0]!.id;
    next = deckReducer(next, { type: 'MODULE/MOVE', deckId, moduleId, position: { x: 187, y: -40 } });
    expect(activeDeck(next)!.modules[0]!.position).toEqual({ x: 180, y: 0 });
  });

  it('does not move or resize a locked module', () => {
    let next = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.gas });
    const moduleId = activeDeck(next)!.modules[0]!.id;
    next = deckReducer(next, { type: 'MODULE/PATCH', deckId, moduleId, patch: { locked: true } });
    const before = activeDeck(next)!.modules[0]!;
    next = deckReducer(next, { type: 'MODULE/MOVE', deckId, moduleId, position: { x: 400, y: 400 } });
    expect(activeDeck(next)!.modules[0]!.position).toEqual(before.position);
  });

  it('enforces the module minimum size on resize', () => {
    let next = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.chart });
    const moduleId = activeDeck(next)!.modules[0]!.id;
    next = deckReducer(next, { type: 'MODULE/RESIZE', deckId, moduleId, size: { width: 20, height: 20 } });
    const module = activeDeck(next)!.modules[0]!;
    expect(module.size.width).toBeGreaterThanOrEqual(280);
    expect(module.size.height).toBeGreaterThanOrEqual(200);
  });

  it('removes a module together with every link touching it', () => {
    let next = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.pairSelector });
    next = deckReducer(next, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.chart });
    const [pair, chart] = activeDeck(next)!.modules;
    next = deckReducer(next, {
      type: 'LINK/CONNECT',
      deckId,
      source: { moduleId: pair!.id, portId: 'pair' },
      target: { moduleId: chart!.id, portId: 'pair' },
    });
    expect(activeDeck(next)!.connections).toHaveLength(1);
    next = deckReducer(next, { type: 'MODULE/REMOVE', deckId, moduleId: pair!.id });
    expect(activeDeck(next)!.modules).toHaveLength(1);
    expect(activeDeck(next)!.connections).toHaveLength(0);
  });

  it('duplicates a module without copying its lock', () => {
    let next = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.notes });
    const moduleId = activeDeck(next)!.modules[0]!.id;
    next = deckReducer(next, { type: 'MODULE/CONFIG', deckId, moduleId, patch: { text: 'plan' } });
    next = deckReducer(next, { type: 'MODULE/PATCH', deckId, moduleId, patch: { locked: true } });
    next = deckReducer(next, { type: 'MODULE/DUPLICATE', deckId, moduleId });
    const modules = activeDeck(next)!.modules;
    expect(modules).toHaveLength(2);
    expect(modules[1]!.id).not.toBe(modules[0]!.id);
    expect(modules[1]!.configuration.text).toBe('plan');
    expect(modules[1]!.locked).toBe(false);
  });
});

describe('deckReducer — links', () => {
  function withPairAndChart() {
    let state = baseState();
    const deckId = state.activeDeckId;
    state = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.pairSelector });
    state = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.chart });
    const [pair, chart] = activeDeck(state)!.modules;
    return { state, deckId, pairId: pair!.id, chartId: chart!.id };
  }

  it('connects compatible ports', () => {
    const { state, deckId, pairId, chartId } = withPairAndChart();
    const next = deckReducer(state, {
      type: 'LINK/CONNECT',
      deckId,
      source: { moduleId: pairId, portId: 'pair' },
      target: { moduleId: chartId, portId: 'pair' },
    });
    expect(activeDeck(next)!.connections).toHaveLength(1);
    expect(next.lastError).toBeNull();
  });

  it('rejects a type mismatch with a readable reason', () => {
    const { state, deckId, pairId, chartId } = withPairAndChart();
    const next = deckReducer(state, {
      type: 'LINK/CONNECT',
      deckId,
      source: { moduleId: pairId, portId: 'tokenA' },
      target: { moduleId: chartId, portId: 'pair' },
    });
    expect(activeDeck(next)!.connections).toHaveLength(0);
    expect(next.lastError).toMatch(/cannot drive/i);
  });

  it('rejects self-links', () => {
    const { state, deckId, pairId } = withPairAndChart();
    const next = deckReducer(state, {
      type: 'LINK/CONNECT',
      deckId,
      source: { moduleId: pairId, portId: 'pair' },
      target: { moduleId: pairId, portId: 'token' },
    });
    expect(next.lastError).toMatch(/itself/);
  });

  it('replaces an existing link into the same input', () => {
    let { state, deckId, pairId, chartId } = withPairAndChart();
    state = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.pairSelector });
    const secondPair = activeDeck(state)!.modules[2]!;
    state = deckReducer(state, {
      type: 'LINK/CONNECT',
      deckId,
      source: { moduleId: pairId, portId: 'pair' },
      target: { moduleId: chartId, portId: 'pair' },
    });
    state = deckReducer(state, {
      type: 'LINK/CONNECT',
      deckId,
      source: { moduleId: secondPair.id, portId: 'pair' },
      target: { moduleId: chartId, portId: 'pair' },
    });
    const connections = activeDeck(state)!.connections;
    expect(connections).toHaveLength(1);
    expect(connections[0]!.sourceModuleId).toBe(secondPair.id);
  });

  it('refuses a link that would close a loop', () => {
    let state = baseState();
    const deckId = state.activeDeckId;
    state = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.calculator });
    state = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.calculator });
    const [a, b] = activeDeck(state)!.modules;
    state = deckReducer(state, {
      type: 'LINK/CONNECT',
      deckId,
      source: { moduleId: a!.id, portId: 'result' },
      target: { moduleId: b!.id, portId: 'value' },
    });
    state = deckReducer(state, {
      type: 'LINK/CONNECT',
      deckId,
      source: { moduleId: b!.id, portId: 'result' },
      target: { moduleId: a!.id, portId: 'value' },
    });
    expect(activeDeck(state)!.connections).toHaveLength(1);
    expect(state.lastError).toMatch(/feedback loop/);
  });

  it('disconnects by id', () => {
    let { state, deckId, pairId, chartId } = withPairAndChart();
    state = deckReducer(state, {
      type: 'LINK/CONNECT',
      deckId,
      source: { moduleId: pairId, portId: 'pair' },
      target: { moduleId: chartId, portId: 'pair' },
    });
    const connectionId = activeDeck(state)!.connections[0]!.id;
    state = deckReducer(state, { type: 'LINK/DISCONNECT', deckId, connectionId });
    expect(activeDeck(state)!.connections).toHaveLength(0);
  });
});

describe('deckReducer — decks', () => {
  it('duplicates a deck with fresh ids and intact wiring', () => {
    let state = baseState();
    const deckId = state.activeDeckId;
    state = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.pairSelector });
    state = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.chart });
    const [pair, chart] = activeDeck(state)!.modules;
    state = deckReducer(state, {
      type: 'LINK/CONNECT',
      deckId,
      source: { moduleId: pair!.id, portId: 'pair' },
      target: { moduleId: chart!.id, portId: 'pair' },
    });
    state = deckReducer(state, { type: 'DECK/DUPLICATE', deckId });

    const copy = activeDeck(state)!;
    expect(state.decks).toHaveLength(2);
    expect(copy.id).not.toBe(deckId);
    expect(copy.modules.map((m) => m.id)).not.toContain(pair!.id);
    expect(copy.connections).toHaveLength(1);
    const link = copy.connections[0]!;
    expect(copy.modules.some((m) => m.id === link.sourceModuleId)).toBe(true);
    expect(copy.modules.some((m) => m.id === link.targetModuleId)).toBe(true);
  });

  it('never deletes the last deck', () => {
    const state = baseState();
    const next = deckReducer(state, { type: 'DECK/REMOVE', deckId: state.activeDeckId });
    expect(next.decks).toHaveLength(1);
    expect(next.lastError).toMatch(/last deck/);
  });
});

describe('deckReducer — swapping slots', () => {
  function twoModules() {
    let state = baseState();
    const deckId = state.activeDeckId;
    state = deckReducer(state, {
      type: 'MODULE/ADD',
      deckId,
      moduleType: MODULE_TYPES.price,
      overrides: { position: { x: 0, y: 0 }, size: { width: 200, height: 160 } },
    });
    state = deckReducer(state, {
      type: 'MODULE/ADD',
      deckId,
      moduleType: MODULE_TYPES.gas,
      overrides: { position: { x: 400, y: 300 }, size: { width: 260, height: 200 } },
    });
    const [a, b] = activeDeck(state)!.modules;
    return { state, deckId, a: a!, b: b! };
  }

  it('exchanges both position and size so the slots truly swap', () => {
    const { state, deckId, a, b } = twoModules();
    const next = deckReducer(state, { type: 'MODULE/SWAP', deckId, moduleId: a.id, targetId: b.id });
    const [movedA, movedB] = activeDeck(next)!.modules;
    expect(movedA.position).toEqual({ x: 400, y: 300 });
    expect(movedA.size).toEqual({ width: 260, height: 200 });
    expect(movedB.position).toEqual({ x: 0, y: 0 });
    expect(movedB.size).toEqual({ width: 200, height: 160 });
  });

  it('keeps every link intact through a swap', () => {
    let { state, deckId, a, b } = twoModules();
    state = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.pairSelector });
    const pair = activeDeck(state)!.modules[2]!;
    state = deckReducer(state, {
      type: 'LINK/CONNECT',
      deckId,
      source: { moduleId: pair.id, portId: 'pair' },
      target: { moduleId: a.id, portId: 'pair' },
    });
    const before = activeDeck(state)!.connections;
    state = deckReducer(state, { type: 'MODULE/SWAP', deckId, moduleId: a.id, targetId: b.id });
    expect(activeDeck(state)!.connections).toEqual(before);
  });

  it('refuses to swap a locked module', () => {
    let { state, deckId, a, b } = twoModules();
    state = deckReducer(state, { type: 'MODULE/PATCH', deckId, moduleId: b.id, patch: { locked: true } });
    const next = deckReducer(state, { type: 'MODULE/SWAP', deckId, moduleId: a.id, targetId: b.id });
    expect(activeDeck(next)!.modules[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it('ignores a swap with itself or with a module that is gone', () => {
    const { state, deckId, a } = twoModules();
    expect(deckReducer(state, { type: 'MODULE/SWAP', deckId, moduleId: a.id, targetId: a.id })).toBe(state);
    expect(deckReducer(state, { type: 'MODULE/SWAP', deckId, moduleId: a.id, targetId: 'ghost' })).toBe(state);
  });

  it('is its own inverse', () => {
    const { state, deckId, a, b } = twoModules();
    const once = deckReducer(state, { type: 'MODULE/SWAP', deckId, moduleId: a.id, targetId: b.id });
    const twice = deckReducer(once, { type: 'MODULE/SWAP', deckId, moduleId: a.id, targetId: b.id });
    expect(activeDeck(twice)!.modules[0]!.position).toEqual({ x: 0, y: 0 });
    expect(activeDeck(twice)!.modules[1]!.position).toEqual({ x: 400, y: 300 });
  });
});

describe('deckReducer — exact moves', () => {
  it('bypasses grid quantisation when the caller resolved the position', () => {
    let state = baseState();
    const deckId = state.activeDeckId;
    state = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.gas });
    const moduleId = activeDeck(state)!.modules[0]!.id;
    state = deckReducer(state, { type: 'MODULE/MOVE', deckId, moduleId, position: { x: 187, y: 213 }, exact: true });
    expect(activeDeck(state)!.modules[0]!.position).toEqual({ x: 187, y: 213 });
  });

  it('still clamps an exact move to the canvas', () => {
    let state = baseState();
    const deckId = state.activeDeckId;
    state = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: MODULE_TYPES.gas });
    const moduleId = activeDeck(state)!.modules[0]!.id;
    state = deckReducer(state, { type: 'MODULE/MOVE', deckId, moduleId, position: { x: -50, y: -20 }, exact: true });
    expect(activeDeck(state)!.modules[0]!.position).toEqual({ x: 0, y: 0 });
  });
});
