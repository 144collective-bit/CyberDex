import { canConnect } from '../modules/ports';
import { getModuleDefinition } from '../modules/registry';
import type { Connection, Deck, ModuleInstance } from '../modules/types';

export interface LinkValidation {
  ok: boolean;
  reason?: string;
}

export interface PortAddress {
  moduleId: string;
  portId: string;
}

function findModule(deck: Deck, id: string): ModuleInstance | undefined {
  return deck.modules.find((m) => m.id === id);
}

export function outputSpec(deck: Deck, addr: PortAddress) {
  const mod = findModule(deck, addr.moduleId);
  if (!mod) return undefined;
  return getModuleDefinition(mod.type)?.outputs.find((p) => p.id === addr.portId);
}

export function inputSpec(deck: Deck, addr: PortAddress) {
  const mod = findModule(deck, addr.moduleId);
  if (!mod) return undefined;
  return getModuleDefinition(mod.type)?.inputs.find((p) => p.id === addr.portId);
}

/**
 * A link is legal when: both ports resolve, types coerce, it is not a
 * self-link, it is not a duplicate, and it does not close a cycle.
 */
export function validateLink(deck: Deck, source: PortAddress, target: PortAddress): LinkValidation {
  if (source.moduleId === target.moduleId) {
    return { ok: false, reason: 'A module cannot link to itself' };
  }
  const out = outputSpec(deck, source);
  if (!out) return { ok: false, reason: 'Unknown output port' };
  const inp = inputSpec(deck, target);
  if (!inp) return { ok: false, reason: 'Unknown input port' };
  if (!canConnect(out.type, inp.type)) {
    return { ok: false, reason: `${out.type.toUpperCase()} cannot drive ${inp.type.toUpperCase()}` };
  }
  const duplicate = deck.connections.some(
    (c) =>
      c.sourceModuleId === source.moduleId &&
      c.sourceOutput === source.portId &&
      c.targetModuleId === target.moduleId &&
      c.targetInput === target.portId,
  );
  if (duplicate) return { ok: false, reason: 'Link already exists' };
  if (createsCycle(deck.connections, source.moduleId, target.moduleId)) {
    return { ok: false, reason: 'Link would create a feedback loop' };
  }
  return { ok: true };
}

/** Would adding source→target close a directed cycle? */
export function createsCycle(connections: Connection[], sourceModuleId: string, targetModuleId: string): boolean {
  const adjacency = new Map<string, string[]>();
  for (const c of connections) {
    const list = adjacency.get(c.sourceModuleId) ?? [];
    list.push(c.targetModuleId);
    adjacency.set(c.sourceModuleId, list);
  }
  // Walk forward from the prospective target; reaching the source closes a loop.
  const seen = new Set<string>();
  const stack = [targetModuleId];
  while (stack.length) {
    const node = stack.pop()!;
    if (node === sourceModuleId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adjacency.get(node) ?? []) stack.push(next);
  }
  return false;
}

/** All connections feeding a module's inputs. */
export function incomingLinks(deck: Deck, moduleId: string): Connection[] {
  return deck.connections.filter((c) => c.targetModuleId === moduleId);
}

export function outgoingLinks(deck: Deck, moduleId: string): Connection[] {
  return deck.connections.filter((c) => c.sourceModuleId === moduleId);
}

/** Upstream module ids a module must subscribe to. */
export function upstreamModuleIds(deck: Deck, moduleId: string): string[] {
  return Array.from(new Set(incomingLinks(deck, moduleId).map((c) => c.sourceModuleId)));
}

/**
 * Resolve a module's inputs from the runtime output values of its sources.
 * Later links win for the same input, matching the reducer's replace-on-connect
 * behaviour.
 */
export function resolveInputs(
  deck: Deck,
  moduleId: string,
  readOutput: (moduleId: string, portId: string) => unknown,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const link of incomingLinks(deck, moduleId)) {
    const value = readOutput(link.sourceModuleId, link.sourceOutput);
    if (value !== undefined) inputs[link.targetInput] = value;
  }
  return inputs;
}

/** Topological order of linked modules; unlinked modules keep deck order. */
export function topologicalOrder(deck: Deck): string[] {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const m of deck.modules) indegree.set(m.id, 0);
  for (const c of deck.connections) {
    if (!indegree.has(c.targetModuleId) || !indegree.has(c.sourceModuleId)) continue;
    indegree.set(c.targetModuleId, (indegree.get(c.targetModuleId) ?? 0) + 1);
    const list = adjacency.get(c.sourceModuleId) ?? [];
    list.push(c.targetModuleId);
    adjacency.set(c.sourceModuleId, list);
  }
  const queue = deck.modules.filter((m) => (indegree.get(m.id) ?? 0) === 0).map((m) => m.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  // Any module left out sat in a cycle; append so nothing is lost.
  for (const m of deck.modules) if (!order.includes(m.id)) order.push(m.id);
  return order;
}
