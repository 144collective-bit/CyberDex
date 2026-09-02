import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { ModuleInstance } from '../core/modules/types';
import { MODULE_TYPES } from './definitions';

export type ModuleComponent = ComponentType<{ module: ModuleInstance }>;

/**
 * Component loaders, one chunk per module.
 *
 * Definitions stay eager (the library, palette and templates need them);
 * component code only arrives when a deck actually places the module.
 */
const LOADERS: Record<string, () => Promise<{ Component: ModuleComponent }>> = {
  [MODULE_TYPES.wallet]: () => import('./components/WalletModule'),
  [MODULE_TYPES.portfolio]: () => import('./components/PortfolioModule'),
  [MODULE_TYPES.allocation]: () => import('./components/AllocationModule'),
  [MODULE_TYPES.pairSelector]: () => import('./components/PairSelectorModule'),
  [MODULE_TYPES.tokenSelector]: () => import('./components/TokenSelectorModule'),
  [MODULE_TYPES.price]: () => import('./components/PriceModule'),
  [MODULE_TYPES.chart]: () => import('./components/ChartModule'),
  [MODULE_TYPES.swap]: () => import('./components/SwapModule'),
  [MODULE_TYPES.quoteComparison]: () => import('./components/QuoteComparisonModule'),
  [MODULE_TYPES.gas]: () => import('./components/GasModule'),
  [MODULE_TYPES.network]: () => import('./components/NetworkModule'),
  [MODULE_TYPES.transactions]: () => import('./components/TransactionsModule'),
  [MODULE_TYPES.calculator]: () => import('./components/CalculatorModule'),
  [MODULE_TYPES.alert]: () => import('./components/AlertModule'),
  [MODULE_TYPES.ratio]: () => import('./components/RatioModule'),
  [MODULE_TYPES.liquidity]: () => import('./components/LiquidityModule'),
  [MODULE_TYPES.tokenInfo]: () => import('./components/TokenInfoModule'),
  [MODULE_TYPES.watchlist]: () => import('./components/WatchlistModule'),
  [MODULE_TYPES.whaleWatch]: () => import('./components/WhaleWatchModule'),
  [MODULE_TYPES.scanner]: () => import('./components/ScannerModule'),
  [MODULE_TYPES.hexStakes]: () => import('./components/HexStakesModule'),
  [MODULE_TYPES.activityLog]: () => import('./components/ActivityLogModule'),
  [MODULE_TYPES.notes]: () => import('./components/NotesModule'),
  [MODULE_TYPES.clock]: () => import('./components/ClockModule'),
};

const cache = new Map<string, LazyExoticComponent<ModuleComponent>>();

export function getModuleComponent(type: string): LazyExoticComponent<ModuleComponent> | null {
  const loader = LOADERS[type];
  if (!loader) return null;
  let component = cache.get(type);
  if (!component) {
    component = lazy(() => loader().then((mod) => ({ default: mod.Component })));
    cache.set(type, component);
  }
  return component;
}

export function hasModuleComponent(type: string): boolean {
  return type in LOADERS;
}
