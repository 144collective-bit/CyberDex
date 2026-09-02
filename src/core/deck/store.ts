import type { EventBus } from '../events/bus';
import { systemBus } from '../events/bus';
import type { PersistenceAdapter } from '../storage/PersistenceAdapter';
import { STORAGE_KEYS } from '../storage/PersistenceAdapter';
import { MemoryAdapter } from '../storage/MemoryAdapter';
import { importDeck } from './schema';
import { deckReducer, activeDeck } from './deckReducer';
import type { DeckAction, WorkspaceState } from './deckReducer';
import type { Deck } from '../modules/types';

interface PersistedWorkspace {
  version: 1;
  decks: unknown[];
  activeDeckId: string;
}

/**
 * Observable workspace store.
 *
 * React subscribes through `useSyncExternalStore` with selectors, so a module
 * move re-renders that module rather than the whole deck. Writes are debounced
 * into the persistence adapter.
 */
export class WorkspaceStore {
  private state: WorkspaceState;
  private listeners = new Set<() => void>();
  private adapter: PersistenceAdapter;
  private bus: EventBus;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistDelay: number;

  constructor(
    initial: WorkspaceState,
    adapter: PersistenceAdapter = new MemoryAdapter(),
    bus: EventBus = systemBus,
    persistDelay = 400,
  ) {
    this.state = initial;
    this.adapter = adapter;
    this.bus = bus;
    this.persistDelay = persistDelay;
  }

  getState = (): WorkspaceState => this.state;

  getActiveDeck = (): Deck | undefined => activeDeck(this.state);

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispatch = (action: DeckAction): WorkspaceState => {
    const prev = this.state;
    const next = deckReducer(prev, action);
    if (next === prev) return prev;
    this.state = next;
    this.announce(action, prev, next);
    this.emitChange();
    this.schedulePersist();
    return next;
  };

  /** Replace the whole workspace (used by hydration and import-all). */
  replace(next: WorkspaceState, persist = true): void {
    this.state = next;
    this.emitChange();
    if (persist) this.schedulePersist();
  }

  async hydrate(): Promise<boolean> {
    const stored = await this.adapter.get<PersistedWorkspace>(STORAGE_KEYS.workspace);
    if (!stored || !Array.isArray(stored.decks) || stored.decks.length === 0) return false;

    const decks: Deck[] = [];
    for (const raw of stored.decks) {
      const result = importDeck(raw);
      if (result.ok && result.deck) decks.push(result.deck);
    }
    if (!decks.length) return false;

    const activeDeckId = decks.some((d) => d.id === stored.activeDeckId)
      ? stored.activeDeckId
      : decks[0]!.id;
    this.replace({ decks, activeDeckId, lastError: null }, false);
    const current = decks.find((d) => d.id === activeDeckId)!;
    this.bus.emit('DECK_LOADED', { deckId: current.id, name: current.name }, 'workspace-store');
    return true;
  }

  /** Force an immediate write; returns once the adapter has accepted it. */
  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const payload: PersistedWorkspace = {
      version: 1,
      decks: this.state.decks,
      activeDeckId: this.state.activeDeckId,
    };
    await this.adapter.set(STORAGE_KEYS.workspace, payload);
    const deck = this.getActiveDeck();
    if (deck) this.bus.emit('DECK_SAVED', { deckId: deck.id, name: deck.name }, 'workspace-store');
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const payload: PersistedWorkspace = {
        version: 1,
        decks: this.state.decks,
        activeDeckId: this.state.activeDeckId,
      };
      void this.adapter.set(STORAGE_KEYS.workspace, payload);
    }, this.persistDelay);
  }

  private emitChange(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }

  /** Translate reducer actions into system events for links, modules and decks. */
  private announce(action: DeckAction, prev: WorkspaceState, next: WorkspaceState): void {
    switch (action.type) {
      case 'MODULE/ADD':
      case 'MODULE/INSERT':
      case 'MODULE/DUPLICATE': {
        const before = new Set(deckModuleIds(prev, action.deckId));
        const added = deckModules(next, action.deckId).filter((m) => !before.has(m.id));
        for (const m of added) this.bus.emit('MODULE_ADDED', { moduleId: m.id, type: m.type }, 'deck');
        break;
      }
      case 'MODULE/REMOVE':
        this.bus.emit('MODULE_REMOVED', { moduleId: action.moduleId }, 'deck');
        break;
      case 'LINK/CONNECT': {
        const before = new Set(deckConnectionIds(prev, action.deckId));
        const created = deckConnections(next, action.deckId).find((c) => !before.has(c.id));
        if (created) {
          this.bus.emit(
            'LINK_CREATED',
            {
              connectionId: created.id,
              from: `${created.sourceModuleId}:${created.sourceOutput}`,
              to: `${created.targetModuleId}:${created.targetInput}`,
            },
            'deck',
          );
        }
        break;
      }
      case 'LINK/DISCONNECT':
        this.bus.emit('LINK_REMOVED', { connectionId: action.connectionId }, 'deck');
        break;
      case 'DECK/ACTIVATE':
      case 'DECK/ADD':
      case 'DECK/DUPLICATE': {
        const deck = activeDeck(next);
        if (deck) this.bus.emit('DECK_LOADED', { deckId: deck.id, name: deck.name }, 'deck');
        break;
      }
      default:
        break;
    }
  }
}

function deckModules(state: WorkspaceState, deckId: string) {
  return state.decks.find((d) => d.id === deckId)?.modules ?? [];
}
function deckModuleIds(state: WorkspaceState, deckId: string) {
  return deckModules(state, deckId).map((m) => m.id);
}
function deckConnections(state: WorkspaceState, deckId: string) {
  return state.decks.find((d) => d.id === deckId)?.connections ?? [];
}
function deckConnectionIds(state: WorkspaceState, deckId: string) {
  return deckConnections(state, deckId).map((c) => c.id);
}
