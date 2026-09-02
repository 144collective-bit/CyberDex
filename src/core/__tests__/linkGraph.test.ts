import { describe, expect, it } from 'vitest';
import { createDeck, deckReducer, activeDeck } from '../deck/deckReducer';
import type { WorkspaceState } from '../deck/deckReducer';
import { ModuleRuntime } from '../modules/runtime';
import { resolveInputs, topologicalOrder, upstreamModuleIds, createsCycle } from '../graph/linkGraph';
import { MODULE_TYPES } from '../../modules/definitions';

function circuit(): { state: WorkspaceState; ids: Record<string, string> } {
  let state: WorkspaceState = (() => {
    const deck = createDeck('CIRCUIT');
    return { decks: [deck], activeDeckId: deck.id, lastError: null };
  })();
  const deckId = state.activeDeckId;
  for (const type of [MODULE_TYPES.wallet, MODULE_TYPES.portfolio, MODULE_TYPES.calculator, MODULE_TYPES.swap]) {
    state = deckReducer(state, { type: 'MODULE/ADD', deckId, moduleType: type });
  }
  const [wallet, portfolio, calc, swap] = activeDeck(state)!.modules;
  const link = (source: string, portId: string, target: string, input: string) => {
    state = deckReducer(state, {
      type: 'LINK/CONNECT',
      deckId,
      source: { moduleId: source, portId },
      target: { moduleId: target, portId: input },
    });
  };
  link(wallet!.id, 'wallet', portfolio!.id, 'wallet');
  link(portfolio!.id, 'totalValue', calc!.id, 'value');
  link(calc!.id, 'result', swap!.id, 'amount');
  link(wallet!.id, 'wallet', swap!.id, 'wallet');
  return {
    state,
    ids: { wallet: wallet!.id, portfolio: portfolio!.id, calc: calc!.id, swap: swap!.id },
  };
}

describe('link graph', () => {
  it('resolves a module’s inputs from upstream runtime outputs', () => {
    const { state, ids } = circuit();
    const deck = activeDeck(state)!;
    const runtime = new ModuleRuntime();
    runtime.setOutputs(ids.portfolio!, { totalValue: 20_000 });
    runtime.setOutputs(ids.calc!, { result: 5_000 });
    runtime.setOutputs(ids.wallet!, { wallet: { address: '0xabc' } });

    const swapInputs = resolveInputs(deck, ids.swap!, (moduleId, portId) => runtime.getOutput(moduleId, portId));
    expect(swapInputs.amount).toBe(5_000);
    expect(swapInputs.wallet).toEqual({ address: '0xabc' });

    const calcInputs = resolveInputs(deck, ids.calc!, (moduleId, portId) => runtime.getOutput(moduleId, portId));
    expect(calcInputs.value).toBe(20_000);
  });

  it('omits inputs whose upstream has published nothing yet', () => {
    const { state, ids } = circuit();
    const runtime = new ModuleRuntime();
    const inputs = resolveInputs(activeDeck(state)!, ids.swap!, (m, p) => runtime.getOutput(m, p));
    expect(inputs).toEqual({});
  });

  it('lists only the upstream modules a module must subscribe to', () => {
    const { state, ids } = circuit();
    const upstream = upstreamModuleIds(activeDeck(state)!, ids.swap!);
    expect(upstream.sort()).toEqual([ids.calc!, ids.wallet!].sort());
  });

  it('orders the circuit from source to sink', () => {
    const { state, ids } = circuit();
    const order = topologicalOrder(activeDeck(state)!);
    expect(order.indexOf(ids.wallet!)).toBeLessThan(order.indexOf(ids.portfolio!));
    expect(order.indexOf(ids.portfolio!)).toBeLessThan(order.indexOf(ids.calc!));
    expect(order.indexOf(ids.calc!)).toBeLessThan(order.indexOf(ids.swap!));
  });

  it('detects a prospective cycle', () => {
    const { state, ids } = circuit();
    const connections = activeDeck(state)!.connections;
    expect(createsCycle(connections, ids.swap!, ids.wallet!)).toBe(true);
    expect(createsCycle(connections, ids.wallet!, ids.swap!)).toBe(false);
  });
});

describe('ModuleRuntime', () => {
  it('notifies only subscribers of the module that changed', () => {
    const runtime = new ModuleRuntime();
    let a = 0;
    let b = 0;
    runtime.subscribe('mod_a', () => (a += 1));
    runtime.subscribe('mod_b', () => (b += 1));
    runtime.setOutputs('mod_a', { price: 1 });
    expect(a).toBe(1);
    expect(b).toBe(0);
  });

  it('skips notification when outputs are shallow-equal', () => {
    const runtime = new ModuleRuntime();
    let calls = 0;
    runtime.subscribe('mod_a', () => (calls += 1));
    runtime.setOutputs('mod_a', { price: 1 });
    runtime.setOutputs('mod_a', { price: 1 });
    expect(calls).toBe(1);
    runtime.setOutputs('mod_a', { price: 2 });
    expect(calls).toBe(2);
  });
});
