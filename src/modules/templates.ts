import { createDeck, cloneDeck, createConnectionId } from '../core/deck/deckReducer';
import type { WorkspaceState } from '../core/deck/deckReducer';
import { createModuleInstance } from '../core/modules/registry';
import type { Connection, Deck, ModuleInstance } from '../core/modules/types';
import { MODULE_TYPES } from './definitions';
import './definitions'; // side-effect: registers every module definition

interface TemplateModule {
  key: string;
  type: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  config?: Record<string, unknown>;
  name?: string;
}

/** [sourceKey, outputPort, targetKey, inputPort] */
type TemplateLink = [string, string, string, string];

export interface DeckTemplate {
  id: string;
  name: string;
  description: string;
  modules: TemplateModule[];
  links: TemplateLink[];
}

export const DECK_TEMPLATES: DeckTemplate[] = [
  {
    id: 'genesis',
    name: 'GENESIS',
    description: 'The starting terminal: wallet, portfolio, pair, price, chart, swap, gas and the transaction feed.',
    modules: [
      { key: 'wallet', type: MODULE_TYPES.wallet, x: 20, y: 20 },
      { key: 'portfolio', type: MODULE_TYPES.portfolio, x: 20, y: 260 },
      { key: 'pair', type: MODULE_TYPES.pairSelector, x: 360, y: 20 },
      { key: 'price', type: MODULE_TYPES.price, x: 700, y: 20 },
      { key: 'gas', type: MODULE_TYPES.gas, x: 700, y: 200 },
      { key: 'chart', type: MODULE_TYPES.chart, x: 360, y: 360, w: 600, h: 340 },
      { key: 'swap', type: MODULE_TYPES.swap, x: 980, y: 20 },
      { key: 'tx', type: MODULE_TYPES.transactions, x: 20, y: 720, w: 940, h: 220 },
    ],
    links: [
      ['pair', 'pair', 'chart', 'pair'],
      ['pair', 'pair', 'price', 'pair'],
      ['pair', 'pair', 'swap', 'pair'],
      ['wallet', 'wallet', 'portfolio', 'wallet'],
      ['wallet', 'wallet', 'swap', 'wallet'],
      ['wallet', 'wallet', 'tx', 'wallet'],
    ],
  },
  {
    id: 'trader',
    name: 'TRADER',
    description: 'Chart-led execution desk with route comparison, liquidity and the live feed.',
    modules: [
      { key: 'pair', type: MODULE_TYPES.pairSelector, x: 20, y: 20 },
      { key: 'chart', type: MODULE_TYPES.chart, x: 360, y: 20, w: 640, h: 400 },
      { key: 'liquidity', type: MODULE_TYPES.liquidity, x: 20, y: 280 },
      { key: 'quotes', type: MODULE_TYPES.quoteComparison, x: 1020, y: 20 },
      { key: 'swap', type: MODULE_TYPES.swap, x: 1020, y: 320 },
      { key: 'gas', type: MODULE_TYPES.gas, x: 20, y: 520 },
      { key: 'tx', type: MODULE_TYPES.transactions, x: 360, y: 440, w: 640, h: 220 },
    ],
    links: [
      ['pair', 'pair', 'chart', 'pair'],
      ['pair', 'pair', 'liquidity', 'pair'],
      ['pair', 'pair', 'quotes', 'pair'],
      ['pair', 'pair', 'swap', 'pair'],
    ],
  },
  {
    id: 'portfolio',
    name: 'PORTFOLIO',
    description: 'Holdings, allocation and history for the connected vault.',
    modules: [
      { key: 'wallet', type: MODULE_TYPES.wallet, x: 20, y: 20 },
      { key: 'portfolio', type: MODULE_TYPES.portfolio, x: 340, y: 20, w: 420, h: 400 },
      { key: 'allocation', type: MODULE_TYPES.allocation, x: 780, y: 20, h: 400 },
      { key: 'watchlist', type: MODULE_TYPES.watchlist, x: 20, y: 260 },
      { key: 'tx', type: MODULE_TYPES.transactions, x: 20, y: 440, w: 1060, h: 240 },
    ],
    links: [
      ['wallet', 'wallet', 'portfolio', 'wallet'],
      ['wallet', 'wallet', 'allocation', 'wallet'],
      ['wallet', 'wallet', 'tx', 'wallet'],
    ],
  },
  {
    id: 'hex-command',
    name: 'HEX COMMAND',
    description: 'HEX-centric war room: ratio, stakes, whale flow and a swap ready to fire.',
    modules: [
      { key: 'pair', type: MODULE_TYPES.pairSelector, x: 20, y: 20, config: { baseSymbol: 'HEX', quoteSymbol: 'PLS' } },
      { key: 'price', type: MODULE_TYPES.price, x: 360, y: 20 },
      { key: 'ratio', type: MODULE_TYPES.ratio, x: 640, y: 20 },
      { key: 'chart', type: MODULE_TYPES.chart, x: 20, y: 280, w: 620, h: 320 },
      { key: 'stakes', type: MODULE_TYPES.hexStakes, x: 660, y: 260 },
      { key: 'swap', type: MODULE_TYPES.swap, x: 1020, y: 20 },
      { key: 'whales', type: MODULE_TYPES.whaleWatch, x: 20, y: 620, w: 620, h: 240 },
      { key: 'alert', type: MODULE_TYPES.alert, x: 660, y: 580, config: { label: 'HEX/PLS FLOOR', condition: 'RATIO_BELOW' } },
    ],
    links: [
      ['pair', 'pair', 'price', 'pair'],
      ['pair', 'pair', 'ratio', 'pair'],
      ['pair', 'pair', 'chart', 'pair'],
      ['pair', 'pair', 'swap', 'pair'],
      ['ratio', 'ratio', 'alert', 'value'],
    ],
  },
  {
    id: 'whale-hunter',
    name: 'WHALE HUNTER',
    description: 'Flow surveillance: scanner, whale movements, liquidity and a value alert.',
    modules: [
      { key: 'scanner', type: MODULE_TYPES.scanner, x: 20, y: 20, w: 460, h: 300 },
      { key: 'whales', type: MODULE_TYPES.whaleWatch, x: 500, y: 20, w: 620, h: 300 },
      { key: 'info', type: MODULE_TYPES.tokenInfo, x: 20, y: 340 },
      { key: 'liquidity', type: MODULE_TYPES.liquidity, x: 340, y: 340 },
      { key: 'alert', type: MODULE_TYPES.alert, x: 660, y: 340, config: { label: 'WHALE SIZE', condition: 'WHALE_VALUE_ABOVE', threshold: 250000 } },
      { key: 'log', type: MODULE_TYPES.activityLog, x: 980, y: 340 },
    ],
    links: [
      ['scanner', 'token', 'info', 'token'],
      ['whales', 'movementValue', 'alert', 'value'],
    ],
  },
  {
    id: 'circuit-demo',
    name: 'BALANCE CIRCUIT',
    description: 'The reference circuit: wallet → balance → 25% calculator → swap amount → trade.',
    modules: [
      { key: 'wallet', type: MODULE_TYPES.wallet, x: 20, y: 20 },
      { key: 'portfolio', type: MODULE_TYPES.portfolio, x: 20, y: 260 },
      { key: 'calc', type: MODULE_TYPES.calculator, x: 380, y: 260, config: { operation: 'percent', operand: 25 } },
      { key: 'pair', type: MODULE_TYPES.pairSelector, x: 380, y: 20 },
      { key: 'swap', type: MODULE_TYPES.swap, x: 700, y: 20 },
      { key: 'tx', type: MODULE_TYPES.transactions, x: 20, y: 580, w: 1020, h: 220 },
    ],
    links: [
      ['wallet', 'wallet', 'portfolio', 'wallet'],
      ['wallet', 'wallet', 'swap', 'wallet'],
      ['portfolio', 'totalValue', 'calc', 'value'],
      ['calc', 'result', 'swap', 'amount'],
      ['pair', 'pair', 'swap', 'pair'],
      ['wallet', 'wallet', 'tx', 'wallet'],
    ],
  },
];

/** Materialise a template into a real deck with fresh ids. */
export function instantiateTemplate(template: DeckTemplate, name = template.name): Deck {
  const idByKey = new Map<string, string>();
  const modules: ModuleInstance[] = template.modules.map((entry) => {
    const instance = createModuleInstance(entry.type, {
      position: { x: entry.x, y: entry.y },
      configuration: entry.config,
      name: entry.name,
      ...(entry.w && entry.h ? { size: { width: entry.w, height: entry.h } } : {}),
    });
    idByKey.set(entry.key, instance.id);
    return instance;
  });

  const connections: Connection[] = template.links
    .filter(([from, , to]) => idByKey.has(from) && idByKey.has(to))
    .map(([from, output, to, input]) => ({
      id: createConnectionId(),
      sourceModuleId: idByKey.get(from)!,
      sourceOutput: output,
      targetModuleId: idByKey.get(to)!,
      targetInput: input,
    }));

  return createDeck(name, {
    modules,
    connections,
    description: template.description,
    templateId: template.id,
  });
}

export function getTemplate(id: string): DeckTemplate | undefined {
  return DECK_TEMPLATES.find((template) => template.id === id);
}

/** First-run workspace: one GENESIS deck, ready to use. */
export function buildDefaultWorkspace(): WorkspaceState {
  const genesis = instantiateTemplate(DECK_TEMPLATES[0]!, 'GENESIS DECK');
  return { decks: [genesis], activeDeckId: genesis.id, lastError: null };
}

export { cloneDeck };
