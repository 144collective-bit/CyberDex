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
/** Actions that only change what you are looking at, so they never enter history. */
const NON_UNDOABLE = new Set<DeckAction['type']>(['ERROR/CLEAR', 'DECK/ACTIVATE', 'MODULE/RAISE']);

const HISTORY_LIMIT = 60;
/** Repeated edits to the same target within this window collapse into one step. */
const COALESCE_MS = 700;

export interface HistoryDepth {
  past: number;
  future: number;
}

export class WorkspaceStore {
  private state: WorkspaceState;
  private listeners = new Set<() => void>();
  private adapter: PersistenceAdapter;
  private bus: EventBus;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistDelay: number;
  private past: WorkspaceState[] = [];
  private future: WorkspaceState[] = [];
  private lastPushKey: string | null = null;
  private lastPushAt = 0;

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
    this.remember(action, prev);
    this.state = next;
    this.announce(action, prev, next);
    this.emitChange();
    this.schedulePersist();
    return next;
  };

  /**
   * Snapshot the pre-action state for undo.
   *
   * Continuous edits — dragging a slider, typing in a Notes module — would
   * otherwise push one entry per keystroke, so consecutive edits to the same
   * target inside a short window replace the previous snapshot instead.
   */
  private remember(action: DeckAction, prev: WorkspaceState): void {
    if (NON_UNDOABLE.has(action.type)) return;
    const key = coalesceKey(action);
    const now = Date.now();
    const coalesce = key !== null && key === this.lastPushKey && now - this.lastPushAt < COALESCE_MS;

    this.lastPushKey = key;
    this.lastPushAt = now;
    // Any new edit invalidates the redo branch.
    this.future = [];
    if (coalesce && this.past.length) return;

    this.past.push(prev);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
  }

  getHistoryDepth = (): HistoryDepth => ({ past: this.past.length, future: this.future.length });

  canUndo = (): boolean => this.past.length > 0;

  canRedo = (): boolean => this.future.length > 0;

  /** Step back one edit. Returns false when there is nothing to undo. */
  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.state);
    this.state = previous;
    this.lastPushKey = null;
    this.emitChange();
    this.schedulePersist();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.state);
    this.state = next;
    this.lastPushKey = null;
    this.emitChange();
    this.schedulePersist();
    return true;
  }

  clearHistory(): void {
    this.past = [];
    this.future = [];
    this.lastPushKey = null;
  }

  /** Replace the whole workspace (used by hydration and import-all). */
  replace(next: WorkspaceState, persist = true): void {
    this.clearHistory();
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

  /**
   * Force an immediate write.
   *
   * Returns whether the deck actually reached durable storage — a degraded
   * adapter keeps the session alive in memory, and callers must not claim a
   * save that did not happen.
   */
  async flush(): Promise<boolean> {
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
    if (this.adapter.degraded) {
      this.bus.emit(
        'SYSTEM_NOTICE',
        { level: 'warning', message: 'DECK HELD IN MEMORY — storage is unavailable, this session only.' },
        'workspace-store',
      );
      return false;
    }
    if (deck) this.bus.emit('DECK_SAVED', { deckId: deck.id, name: deck.name }, 'workspace-store');
    return true;
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

/**
 * Identity of the thing an action edits, for coalescing. Null means the action
 * always gets its own history entry.
 */
function coalesceKey(action: DeckAction): string | null {
  switch (action.type) {
    case 'MODULE/CONFIG':
      return `config:${action.moduleId}:${Object.keys(action.patch).sort().join(',')}`;
    case 'MODULE/MOVE':
      return `move:${action.moduleId}`;
    case 'MODULE/RESIZE':
      return `resize:${action.moduleId}`;
    case 'DECK/RENAME':
      return `rename:${action.deckId}`;
    case 'DECK/SETTINGS':
      return `settings:${action.deckId}:${Object.keys(action.patch).sort().join(',')}`;
    case 'MODULE/PATCH':
      return `patch:${action.moduleId}:${Object.keys(action.patch).sort().join(',')}`;
    default:
      return null;
  }
}
