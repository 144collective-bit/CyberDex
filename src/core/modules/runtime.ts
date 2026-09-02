type Listener = () => void;

/**
 * Per-module output store.
 *
 * Modules write their outputs here; downstream modules subscribe to the
 * specific upstream module ids they are linked to. A price tick therefore
 * re-renders the price module and its subscribers — never the whole deck.
 */
export class ModuleRuntime {
  private outputs = new Map<string, Record<string, unknown>>();
  private listeners = new Map<string, Set<Listener>>();

  setOutputs(moduleId: string, next: Record<string, unknown>): void {
    const prev = this.outputs.get(moduleId);
    if (prev && shallowEqual(prev, next)) return;
    this.outputs.set(moduleId, next);
    this.notify(moduleId);
  }

  patchOutputs(moduleId: string, patch: Record<string, unknown>): void {
    const prev = this.outputs.get(moduleId) ?? {};
    this.setOutputs(moduleId, { ...prev, ...patch });
  }

  getOutputs(moduleId: string): Record<string, unknown> {
    return this.outputs.get(moduleId) ?? EMPTY;
  }

  getOutput(moduleId: string, portId: string): unknown {
    return this.outputs.get(moduleId)?.[portId];
  }

  clearModule(moduleId: string): void {
    if (!this.outputs.has(moduleId)) return;
    this.outputs.delete(moduleId);
    this.notify(moduleId);
  }

  subscribe(moduleId: string, listener: Listener): () => void {
    let set = this.listeners.get(moduleId);
    if (!set) {
      set = new Set();
      this.listeners.set(moduleId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) this.listeners.delete(moduleId);
    };
  }

  private notify(moduleId: string): void {
    const set = this.listeners.get(moduleId);
    if (!set) return;
    for (const listener of Array.from(set)) listener();
  }

  reset(): void {
    this.outputs.clear();
    this.listeners.clear();
  }
}

const EMPTY: Record<string, unknown> = Object.freeze({});

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const key of ak) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

export const moduleRuntime = new ModuleRuntime();
