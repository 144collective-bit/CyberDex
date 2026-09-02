import { getModuleDefinition } from '../modules/registry';
import { DECK_FORMAT_VERSION } from '../modules/types';
import type { Connection, Deck, DeckExport, ModuleInstance } from '../modules/types';
import { DEFAULT_DECK_SETTINGS, createDeckId, createConnectionId } from './deckReducer';

export interface DeckImportResult {
  ok: boolean;
  deck?: Deck;
  errors: string[];
  warnings: string[];
}

export function exportDeck(deck: Deck): DeckExport {
  return { version: DECK_FORMAT_VERSION, exportedAt: Date.now(), app: 'cyber-dex', deck };
}

export function serializeDeck(deck: Deck): string {
  return JSON.stringify(exportDeck(deck), null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Import is defensive on purpose: a deck may be hand-edited, shared, or written
 * by an older build. Unknown module types are dropped with a warning rather
 * than failing the whole import, and module versions are migrated forward.
 */
export function importDeck(payload: unknown, options: { freshIds?: boolean } = {}): DeckImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let source: unknown = payload;
  if (typeof payload === 'string') {
    try {
      source = JSON.parse(payload);
    } catch {
      return { ok: false, errors: ['File is not valid JSON'], warnings };
    }
  }
  if (!isRecord(source)) return { ok: false, errors: ['Deck payload is not an object'], warnings };

  const raw = isRecord(source.deck) ? source.deck : source;
  const formatVersion = typeof source.version === 'string' ? source.version : DECK_FORMAT_VERSION;
  if (formatVersion.split('.')[0] !== DECK_FORMAT_VERSION.split('.')[0]) {
    errors.push(`Unsupported deck format ${formatVersion} (expected ${DECK_FORMAT_VERSION}.x)`);
    return { ok: false, errors, warnings };
  }

  if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push('Deck is missing a name');
  if (!Array.isArray(raw.modules)) errors.push('Deck is missing a modules array');
  if (errors.length) return { ok: false, errors, warnings };

  const idMap = new Map<string, string>();
  const modules: ModuleInstance[] = [];

  for (const entry of raw.modules as unknown[]) {
    if (!isRecord(entry) || typeof entry.type !== 'string') {
      warnings.push('Skipped a malformed module entry');
      continue;
    }
    const def = getModuleDefinition(entry.type);
    if (!def) {
      warnings.push(`Skipped unknown module type "${entry.type}"`);
      continue;
    }
    const originalId = typeof entry.id === 'string' ? entry.id : `mod_${modules.length}`;
    const id = options.freshIds ? `${originalId}_${Math.random().toString(36).slice(2, 8)}` : originalId;
    idMap.set(originalId, id);

    const incomingVersion = typeof entry.version === 'string' ? entry.version : '0.0.0';
    if (incomingVersion !== def.version) {
      warnings.push(`${def.name}: migrated ${incomingVersion} → ${def.version}`);
    }
    const position = isRecord(entry.position) ? entry.position : {};
    const size = isRecord(entry.size) ? entry.size : {};

    modules.push({
      id,
      type: entry.type,
      version: def.version,
      name: typeof entry.name === 'string' ? entry.name : def.name,
      position: {
        x: numberOr(position.x, 40),
        y: numberOr(position.y, 40),
      },
      size: {
        width: Math.max(def.minSize.width, numberOr(size.width, def.defaultSize.width)),
        height: Math.max(def.minSize.height, numberOr(size.height, def.defaultSize.height)),
      },
      // Defaults first so a config written by an older module version gains new keys.
      configuration: { ...def.defaultConfig, ...(isRecord(entry.configuration) ? entry.configuration : {}) },
      locked: entry.locked === true,
      collapsed: entry.collapsed === true,
      pinned: entry.pinned === true,
      groupId: typeof entry.groupId === 'string' ? entry.groupId : null,
      mobileSize: entry.mobileSize === 'compact' || entry.mobileSize === 'full' ? entry.mobileSize : 'half',
    });
  }

  const connections: Connection[] = [];
  const rawConnections = Array.isArray(raw.connections) ? (raw.connections as unknown[]) : [];
  for (const entry of rawConnections) {
    if (!isRecord(entry)) continue;
    const sourceModuleId = idMap.get(String(entry.sourceModuleId));
    const targetModuleId = idMap.get(String(entry.targetModuleId));
    if (!sourceModuleId || !targetModuleId) {
      warnings.push('Dropped a link pointing at a missing module');
      continue;
    }
    connections.push({
      id: options.freshIds || typeof entry.id !== 'string' ? createConnectionId() : entry.id,
      sourceModuleId,
      sourceOutput: String(entry.sourceOutput),
      targetModuleId,
      targetInput: String(entry.targetInput),
    });
  }

  const settings = isRecord(raw.settings) ? raw.settings : {};
  const deck: Deck = {
    id: options.freshIds || typeof raw.id !== 'string' ? createDeckId() : raw.id,
    name: String(raw.name),
    description: typeof raw.description === 'string' ? raw.description : undefined,
    modules,
    connections,
    groups: Array.isArray(raw.groups) ? (raw.groups as Deck['groups']) : [],
    settings: { ...DEFAULT_DECK_SETTINGS, ...settings } as Deck['settings'],
    createdAt: numberOr(raw.createdAt, Date.now()),
    updatedAt: Date.now(),
    templateId: typeof raw.templateId === 'string' ? raw.templateId : undefined,
  };

  return { ok: true, deck, errors, warnings };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
