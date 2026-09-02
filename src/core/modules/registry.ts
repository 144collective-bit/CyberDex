import type { ModuleCategory, ModuleDefinition, ModuleInstance } from './types';

const registry = new Map<string, ModuleDefinition<any>>();

export function registerModule<C>(definition: ModuleDefinition<C>): ModuleDefinition<C> {
  if (registry.has(definition.type)) {
    // Re-registration happens on HMR; last one wins rather than throwing.
    registry.set(definition.type, definition as ModuleDefinition<any>);
    return definition;
  }
  registry.set(definition.type, definition as ModuleDefinition<any>);
  return definition;
}

export function getModuleDefinition(type: string): ModuleDefinition<any> | undefined {
  return registry.get(type);
}

export function requireModuleDefinition(type: string): ModuleDefinition<any> {
  const def = registry.get(type);
  if (!def) throw new Error(`Unknown module type: ${type}`);
  return def;
}

export function listModuleDefinitions(): ModuleDefinition<any>[] {
  return Array.from(registry.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function listCategories(): ModuleCategory[] {
  const order: ModuleCategory[] = [
    'MARKET',
    'TOKENS',
    'WALLET',
    'TRADING',
    'LIQUIDITY',
    'STAKING',
    'ANALYTICS',
    'INTELLIGENCE',
    'NETWORK',
    'SYSTEM',
  ];
  const present = new Set(listModuleDefinitions().map((d) => d.category));
  return order.filter((c) => present.has(c));
}

export function searchModuleDefinitions(query: string): ModuleDefinition<any>[] {
  const q = query.trim().toLowerCase();
  if (!q) return listModuleDefinitions();
  return listModuleDefinitions().filter((def) => {
    const haystack = [def.name, def.type, def.description, def.category, ...(def.keywords ?? [])]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

let instanceSeq = 0;

export function createModuleId(type: string): string {
  return `mod_${type}_${Date.now().toString(36)}_${(instanceSeq++).toString(36)}`;
}

export function createModuleInstance(
  type: string,
  overrides: Partial<ModuleInstance> = {},
): ModuleInstance {
  const def = requireModuleDefinition(type);
  return {
    id: overrides.id ?? createModuleId(type),
    type,
    version: def.version,
    name: overrides.name ?? def.name,
    position: overrides.position ?? { x: 40, y: 40 },
    size: overrides.size ?? { ...def.defaultSize },
    configuration: { ...def.defaultConfig, ...(overrides.configuration ?? {}) },
    locked: overrides.locked ?? false,
    collapsed: overrides.collapsed ?? false,
    pinned: overrides.pinned ?? false,
    groupId: overrides.groupId ?? null,
    mobileSize: overrides.mobileSize ?? 'half',
  };
}

/** Test/HMR helper. */
export function clearRegistry(): void {
  registry.clear();
}
