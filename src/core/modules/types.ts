import type { PortSpec } from './ports';

export type ModuleCategory =
  | 'MARKET'
  | 'TOKENS'
  | 'WALLET'
  | 'TRADING'
  | 'LIQUIDITY'
  | 'STAKING'
  | 'ANALYTICS'
  | 'INTELLIGENCE'
  | 'NETWORK'
  | 'SYSTEM';

export type ModulePermission = 'READ_ONLY' | 'EXECUTION_CAPABLE';

export interface ModuleSize {
  width: number;
  height: number;
}

export interface ModulePosition {
  x: number;
  y: number;
}

export type MobileSize = 'compact' | 'half' | 'full';

/**
 * The declarative half of a module. Registered once, machine-readable, and the
 * only thing an AI (or a deck template, or the library UI) needs in order to
 * place a module and wire it up.
 */
export interface ModuleDefinition<Config = Record<string, unknown>> {
  type: string;
  name: string;
  version: string;
  category: ModuleCategory;
  icon: string;
  description: string;
  permission: ModulePermission;
  inputs: PortSpec[];
  outputs: PortSpec[];
  defaultSize: ModuleSize;
  minSize: ModuleSize;
  defaultConfig: Config;
  /** Search aliases for the library + command palette. */
  keywords?: string[];
  /** Rendered without body padding (charts, tables). */
  flush?: boolean;
}

export interface ModuleInstance<Config = Record<string, unknown>> {
  id: string;
  type: string;
  /** Version the instance was created with — used to migrate old decks. */
  version: string;
  name: string;
  position: ModulePosition;
  size: ModuleSize;
  configuration: Config;
  locked: boolean;
  collapsed: boolean;
  pinned: boolean;
  groupId?: string | null;
  mobileSize?: MobileSize;
}

export interface Connection {
  id: string;
  sourceModuleId: string;
  sourceOutput: string;
  targetModuleId: string;
  targetInput: string;
}

export interface ModuleGroup {
  id: string;
  name: string;
  color?: string;
}

export interface DeckSettings {
  theme: string;
  density: 'compact' | 'normal' | 'comfortable';
  chainId: number;
  walletId: string | null;
  showLinks: boolean;
  snapToGrid: boolean;
  gridSize: number;
}

export interface Deck {
  id: string;
  name: string;
  description?: string;
  modules: ModuleInstance[];
  connections: Connection[];
  groups: ModuleGroup[];
  settings: DeckSettings;
  createdAt: number;
  updatedAt: number;
  templateId?: string;
}

export const DECK_FORMAT_VERSION = '1.0';

export interface DeckExport {
  version: string;
  exportedAt: number;
  app: 'cyber-dex';
  deck: Deck;
}
