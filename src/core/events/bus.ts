import type { EventRecord, SystemEventMap, SystemEventName } from './types';

type Handler<K extends SystemEventName> = (payload: SystemEventMap[K], record: EventRecord<K>) => void;
type AnyHandler = (record: EventRecord) => void;

let seq = 0;
const nextId = () => `evt_${Date.now().toString(36)}_${(seq++).toString(36)}`;

/**
 * Central publish/subscribe bus.
 *
 * Deliberately dependency-free and synchronous: subscribers get the payload in
 * emit order, and a bounded history feeds the Activity Log. Handler errors are
 * contained so one broken module cannot take the deck down.
 */
export class EventBus {
  private handlers = new Map<SystemEventName, Set<Handler<never>>>();
  private anyHandlers = new Set<AnyHandler>();
  private history: EventRecord[] = [];
  private historyLimit: number;

  constructor(historyLimit = 300) {
    this.historyLimit = historyLimit;
  }

  on<K extends SystemEventName>(type: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => {
      set?.delete(handler as Handler<never>);
    };
  }

  onAny(handler: AnyHandler): () => void {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  emit<K extends SystemEventName>(type: K, payload: SystemEventMap[K], origin = 'system'): EventRecord<K> {
    const record: EventRecord<K> = { id: nextId(), type, payload, at: Date.now(), origin };

    this.history.push(record as EventRecord);
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }

    const set = this.handlers.get(type);
    if (set) {
      for (const handler of Array.from(set) as Handler<K>[]) {
        try {
          handler(payload, record);
        } catch (err) {
          console.error(`[bus] handler for ${type} threw`, err);
        }
      }
    }
    for (const handler of Array.from(this.anyHandlers)) {
      try {
        handler(record as EventRecord);
      } catch (err) {
        console.error('[bus] wildcard handler threw', err);
      }
    }
    return record;
  }

  getHistory(): readonly EventRecord[] {
    return this.history;
  }

  clearHistory(): void {
    this.history = [];
  }

  /** Test helper — drops every subscription. */
  reset(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
    this.history = [];
  }
}

export const systemBus = new EventBus();
