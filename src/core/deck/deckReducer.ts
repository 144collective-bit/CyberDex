import { createModuleInstance, getModuleDefinition } from '../modules/registry';
import { validateLink } from '../graph/linkGraph';
import type {
  Connection,
  Deck,
  DeckSettings,
  ModuleGroup,
  ModuleInstance,
  ModulePosition,
  ModuleSize,
} from '../modules/types';

export interface WorkspaceState {
  decks: Deck[];
  activeDeckId: string;
  /** Reason the last action was rejected, surfaced by the UI. */
  lastError: string | null;
}

export type DeckAction =
  | { type: 'DECK/ADD'; deck: Deck; activate?: boolean }
  | { type: 'DECK/REMOVE'; deckId: string }
  | { type: 'DECK/DUPLICATE'; deckId: string; name?: string }
  | { type: 'DECK/RENAME'; deckId: string; name: string }
  | { type: 'DECK/ACTIVATE'; deckId: string }
  | { type: 'DECK/RESET'; deckId: string; deck: Deck }
  | { type: 'DECK/SETTINGS'; deckId: string; patch: Partial<DeckSettings> }
  | { type: 'MODULE/ADD'; deckId: string; moduleType: string; overrides?: Partial<ModuleInstance> }
  | { type: 'MODULE/INSERT'; deckId: string; module: ModuleInstance }
  | { type: 'MODULE/REMOVE'; deckId: string; moduleId: string }
  | { type: 'MODULE/MOVE'; deckId: string; moduleId: string; position: ModulePosition }
  | { type: 'MODULE/RESIZE'; deckId: string; moduleId: string; size: ModuleSize }
  | { type: 'MODULE/PATCH'; deckId: string; moduleId: string; patch: Partial<ModuleInstance> }
  | { type: 'MODULE/CONFIG'; deckId: string; moduleId: string; patch: Record<string, unknown> }
  | { type: 'MODULE/DUPLICATE'; deckId: string; moduleId: string }
  | { type: 'MODULE/RAISE'; deckId: string; moduleId: string }
  | { type: 'LINK/CONNECT'; deckId: string; source: { moduleId: string; portId: string }; target: { moduleId: string; portId: string } }
  | { type: 'LINK/DISCONNECT'; deckId: string; connectionId: string }
  | { type: 'GROUP/CREATE'; deckId: string; name: string; moduleIds: string[] }
  | { type: 'GROUP/REMOVE'; deckId: string; groupId: string }
  | { type: 'ERROR/CLEAR' };

let idSeq = 0;
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(idSeq++).toString(36)}`;

export function createConnectionId(): string {
  return uid('link');
}

export function createDeckId(): string {
  return uid('deck');
}

export const DEFAULT_DECK_SETTINGS: DeckSettings = {
  theme: 'cyber-dark',
  density: 'compact',
  chainId: 369,
  walletId: null,
  showLinks: true,
  snapToGrid: true,
  gridSize: 20,
};

export function createDeck(name: string, partial: Partial<Deck> = {}): Deck {
  const now = Date.now();
  return {
    id: partial.id ?? createDeckId(),
    name,
    description: partial.description,
    modules: partial.modules ?? [],
    connections: partial.connections ?? [],
    groups: partial.groups ?? [],
    settings: { ...DEFAULT_DECK_SETTINGS, ...(partial.settings ?? {}) },
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
    templateId: partial.templateId,
  };
}

function snap(value: number, grid: number, enabled: boolean): number {
  if (!enabled || grid <= 1) return Math.round(value);
  return Math.round(value / grid) * grid;
}

function touch(deck: Deck): Deck {
  return { ...deck, updatedAt: Date.now() };
}

function mapDeck(state: WorkspaceState, deckId: string, fn: (deck: Deck) => Deck | null): WorkspaceState {
  let changed = false;
  let error: string | null = null;
  const decks = state.decks.map((deck) => {
    if (deck.id !== deckId) return deck;
    const next = fn(deck);
    if (next === null) return deck;
    if (next === deck) return deck;
    changed = true;
    return touch(next);
  });
  if (!changed) return error ? { ...state, lastError: error } : state;
  return { ...state, decks, lastError: null };
}

function withError(state: WorkspaceState, reason: string): WorkspaceState {
  return { ...state, lastError: reason };
}

export function deckReducer(state: WorkspaceState, action: DeckAction): WorkspaceState {
  switch (action.type) {
    case 'ERROR/CLEAR':
      return state.lastError === null ? state : { ...state, lastError: null };

    case 'DECK/ADD': {
      const decks = [...state.decks, action.deck];
      return {
        ...state,
        decks,
        activeDeckId: action.activate === false ? state.activeDeckId : action.deck.id,
        lastError: null,
      };
    }

    case 'DECK/REMOVE': {
      if (state.decks.length <= 1) return withError(state, 'The last deck cannot be deleted');
      const decks = state.decks.filter((d) => d.id !== action.deckId);
      const activeDeckId =
        state.activeDeckId === action.deckId ? (decks[0]?.id ?? '') : state.activeDeckId;
      return { ...state, decks, activeDeckId, lastError: null };
    }

    case 'DECK/DUPLICATE': {
      const source = state.decks.find((d) => d.id === action.deckId);
      if (!source) return withError(state, 'Deck not found');
      const copy = cloneDeck(source, action.name ?? `${source.name} COPY`);
      return { ...state, decks: [...state.decks, copy], activeDeckId: copy.id, lastError: null };
    }

    case 'DECK/RENAME':
      return mapDeck(state, action.deckId, (deck) =>
        deck.name === action.name ? deck : { ...deck, name: action.name },
      );

    case 'DECK/ACTIVATE':
      if (!state.decks.some((d) => d.id === action.deckId)) return withError(state, 'Deck not found');
      return { ...state, activeDeckId: action.deckId, lastError: null };

    case 'DECK/RESET':
      return mapDeck(state, action.deckId, () => ({ ...action.deck, id: action.deckId }));

    case 'DECK/SETTINGS':
      return mapDeck(state, action.deckId, (deck) => ({
        ...deck,
        settings: { ...deck.settings, ...action.patch },
      }));

    case 'MODULE/ADD': {
      if (!getModuleDefinition(action.moduleType)) {
        return withError(state, `Unknown module type: ${action.moduleType}`);
      }
      const instance = createModuleInstance(action.moduleType, action.overrides);
      return mapDeck(state, action.deckId, (deck) => ({ ...deck, modules: [...deck.modules, instance] }));
    }

    case 'MODULE/INSERT':
      return mapDeck(state, action.deckId, (deck) => ({ ...deck, modules: [...deck.modules, action.module] }));

    case 'MODULE/REMOVE':
      return mapDeck(state, action.deckId, (deck) => ({
        ...deck,
        modules: deck.modules.filter((m) => m.id !== action.moduleId),
        connections: deck.connections.filter(
          (c) => c.sourceModuleId !== action.moduleId && c.targetModuleId !== action.moduleId,
        ),
      }));

    case 'MODULE/MOVE':
      return mapDeck(state, action.deckId, (deck) => {
        const target = deck.modules.find((m) => m.id === action.moduleId);
        if (!target || target.locked) return null;
        const { snapToGrid, gridSize } = deck.settings;
        const position = {
          x: Math.max(0, snap(action.position.x, gridSize, snapToGrid)),
          y: Math.max(0, snap(action.position.y, gridSize, snapToGrid)),
        };
        if (position.x === target.position.x && position.y === target.position.y) return null;
        return {
          ...deck,
          modules: deck.modules.map((m) => (m.id === action.moduleId ? { ...m, position } : m)),
        };
      });

    case 'MODULE/RESIZE':
      return mapDeck(state, action.deckId, (deck) => {
        const target = deck.modules.find((m) => m.id === action.moduleId);
        if (!target || target.locked) return null;
        const def = getModuleDefinition(target.type);
        const min = def?.minSize ?? { width: 160, height: 120 };
        const { snapToGrid, gridSize } = deck.settings;
        const size = {
          width: Math.max(min.width, snap(action.size.width, gridSize, snapToGrid)),
          height: Math.max(min.height, snap(action.size.height, gridSize, snapToGrid)),
        };
        if (size.width === target.size.width && size.height === target.size.height) return null;
        return {
          ...deck,
          modules: deck.modules.map((m) => (m.id === action.moduleId ? { ...m, size } : m)),
        };
      });

    case 'MODULE/PATCH':
      return mapDeck(state, action.deckId, (deck) => ({
        ...deck,
        modules: deck.modules.map((m) => (m.id === action.moduleId ? { ...m, ...action.patch } : m)),
      }));

    case 'MODULE/CONFIG':
      return mapDeck(state, action.deckId, (deck) => ({
        ...deck,
        modules: deck.modules.map((m) =>
          m.id === action.moduleId ? { ...m, configuration: { ...m.configuration, ...action.patch } } : m,
        ),
      }));

    case 'MODULE/DUPLICATE':
      return mapDeck(state, action.deckId, (deck) => {
        const source = deck.modules.find((m) => m.id === action.moduleId);
        if (!source) return null;
        const copy: ModuleInstance = {
          ...source,
          id: uid(`mod_${source.type}`),
          name: source.name,
          position: { x: source.position.x + deck.settings.gridSize, y: source.position.y + deck.settings.gridSize },
          configuration: { ...source.configuration },
          locked: false,
        };
        return { ...deck, modules: [...deck.modules, copy] };
      });

    case 'MODULE/RAISE':
      return mapDeck(state, action.deckId, (deck) => {
        const index = deck.modules.findIndex((m) => m.id === action.moduleId);
        if (index < 0 || index === deck.modules.length - 1) return null;
        const modules = [...deck.modules];
        const [module] = modules.splice(index, 1);
        modules.push(module!);
        return { ...deck, modules };
      });

    case 'LINK/CONNECT': {
      const deck = state.decks.find((d) => d.id === action.deckId);
      if (!deck) return withError(state, 'Deck not found');
      const check = validateLink(deck, action.source, action.target);
      if (!check.ok) return withError(state, check.reason ?? 'Link rejected');
      const connection: Connection = {
        id: createConnectionId(),
        sourceModuleId: action.source.moduleId,
        sourceOutput: action.source.portId,
        targetModuleId: action.target.moduleId,
        targetInput: action.target.portId,
      };
      return mapDeck(state, action.deckId, (d) => ({
        ...d,
        // An input takes a single source: connecting replaces the previous link.
        connections: [
          ...d.connections.filter(
            (c) => !(c.targetModuleId === connection.targetModuleId && c.targetInput === connection.targetInput),
          ),
          connection,
        ],
      }));
    }

    case 'LINK/DISCONNECT':
      return mapDeck(state, action.deckId, (deck) => {
        if (!deck.connections.some((c) => c.id === action.connectionId)) return null;
        return { ...deck, connections: deck.connections.filter((c) => c.id !== action.connectionId) };
      });

    case 'GROUP/CREATE': {
      const group: ModuleGroup = { id: uid('grp'), name: action.name };
      return mapDeck(state, action.deckId, (deck) => ({
        ...deck,
        groups: [...deck.groups, group],
        modules: deck.modules.map((m) =>
          action.moduleIds.includes(m.id) ? { ...m, groupId: group.id } : m,
        ),
      }));
    }

    case 'GROUP/REMOVE':
      return mapDeck(state, action.deckId, (deck) => ({
        ...deck,
        groups: deck.groups.filter((g) => g.id !== action.groupId),
        modules: deck.modules.map((m) => (m.groupId === action.groupId ? { ...m, groupId: null } : m)),
      }));

    default:
      return state;
  }
}

/** Deep copy with fresh ids, keeping links intact. */
export function cloneDeck(source: Deck, name: string): Deck {
  const idMap = new Map<string, string>();
  const modules = source.modules.map((m) => {
    const id = uid(`mod_${m.type}`);
    idMap.set(m.id, id);
    return { ...m, id, configuration: { ...m.configuration }, position: { ...m.position }, size: { ...m.size } };
  });
  const connections = source.connections
    .filter((c) => idMap.has(c.sourceModuleId) && idMap.has(c.targetModuleId))
    .map((c) => ({
      ...c,
      id: createConnectionId(),
      sourceModuleId: idMap.get(c.sourceModuleId)!,
      targetModuleId: idMap.get(c.targetModuleId)!,
    }));
  return {
    ...source,
    id: createDeckId(),
    name,
    modules,
    connections,
    groups: source.groups.map((g) => ({ ...g })),
    settings: { ...source.settings },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function activeDeck(state: WorkspaceState): Deck | undefined {
  return state.decks.find((d) => d.id === state.activeDeckId) ?? state.decks[0];
}
