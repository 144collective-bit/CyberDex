import { registerModule } from '../core/modules/registry';
import type { ModuleDefinition } from '../core/modules/types';

/**
 * Every module's declarative spec.
 *
 * Kept apart from the components on purpose: the library, command palette,
 * deck templates, importer and (later) an AI deck builder all need to reason
 * about modules without loading their UI. Component code is lazy-loaded.
 */

const define = <C extends Record<string, unknown>>(def: ModuleDefinition<C>): ModuleDefinition<C> =>
  registerModule(def);

export const MODULE_TYPES = {
  wallet: 'wallet',
  portfolio: 'portfolio',
  allocation: 'allocation',
  pairSelector: 'pair-selector',
  tokenSelector: 'token-selector',
  price: 'price',
  chart: 'chart',
  swap: 'swap',
  quoteComparison: 'quote-comparison',
  gas: 'gas',
  network: 'network',
  transactions: 'transactions',
  calculator: 'calculator',
  alert: 'alert',
  ratio: 'ratio',
  liquidity: 'liquidity',
  tokenInfo: 'token-info',
  watchlist: 'watchlist',
  whaleWatch: 'whale-watch',
  scanner: 'market-scanner',
  hexStakes: 'hex-stakes',
  activityLog: 'activity-log',
  notes: 'notes',
  clock: 'clock',
} as const;

export const walletModule = define({
  type: MODULE_TYPES.wallet,
  name: 'WALLET',
  version: '1.0.0',
  category: 'WALLET',
  icon: '◈',
  description: 'Connect an execution wallet, add watch wallets, and broadcast wallet state to the deck.',
  permission: 'READ_ONLY',
  inputs: [],
  outputs: [
    { id: 'wallet', label: 'WALLET', type: 'wallet', description: 'Active wallet record' },
    { id: 'address', label: 'ADDRESS', type: 'address' },
    { id: 'network', label: 'NETWORK', type: 'network' },
  ],
  defaultSize: { width: 300, height: 220 },
  minSize: { width: 240, height: 160 },
  defaultConfig: { showBalances: true },
  keywords: ['vault', 'connect', 'account', 'metamask'],
});

export const portfolioModule = define({
  type: MODULE_TYPES.portfolio,
  name: 'PORTFOLIO',
  version: '1.0.0',
  category: 'WALLET',
  icon: '▤',
  description: 'Holdings, value and weighted change for the connected or linked wallet.',
  permission: 'READ_ONLY',
  inputs: [{ id: 'wallet', label: 'WALLET', type: 'wallet', optional: true }],
  outputs: [
    { id: 'totalValue', label: 'TOTAL', type: 'number' },
    { id: 'token', label: 'SELECTED', type: 'token' },
    { id: 'balance', label: 'BALANCE', type: 'balance' },
  ],
  defaultSize: { width: 340, height: 300 },
  minSize: { width: 260, height: 180 },
  defaultConfig: { sort: 'value', hideDust: true },
  keywords: ['holdings', 'assets', 'balances', 'pnl'],
});

export const allocationModule = define({
  type: MODULE_TYPES.allocation,
  name: 'ASSET ALLOCATION',
  version: '1.0.0',
  category: 'WALLET',
  icon: '◐',
  description: 'Weight of each asset in the linked wallet, as bars and percentages.',
  permission: 'READ_ONLY',
  inputs: [{ id: 'wallet', label: 'WALLET', type: 'wallet', optional: true }],
  outputs: [{ id: 'token', label: 'SELECTED', type: 'token' }],
  defaultSize: { width: 300, height: 240 },
  minSize: { width: 220, height: 160 },
  defaultConfig: {},
  keywords: ['weights', 'split', 'distribution'],
});

export const pairSelectorModule = define({
  type: MODULE_TYPES.pairSelector,
  name: 'PAIR SELECTOR',
  version: '1.0.0',
  category: 'TOKENS',
  icon: '⇄',
  description: 'Choose two assets and drive every connected module with the resulting pair.',
  permission: 'READ_ONLY',
  inputs: [{ id: 'token', label: 'TOKEN', type: 'token', optional: true }],
  outputs: [
    { id: 'pair', label: 'PAIR', type: 'pair' },
    { id: 'tokenA', label: 'TOKEN A', type: 'token' },
    { id: 'tokenB', label: 'TOKEN B', type: 'token' },
    { id: 'ratio', label: 'RATIO', type: 'ratio' },
  ],
  defaultSize: { width: 320, height: 240 },
  minSize: { width: 250, height: 190 },
  defaultConfig: { baseSymbol: 'HEX', quoteSymbol: 'PLS', syncGlobal: true },
  keywords: ['pair', 'market', 'tokens', 'hex/pls'],
});

export const tokenSelectorModule = define({
  type: MODULE_TYPES.tokenSelector,
  name: 'TOKEN SELECTOR',
  version: '1.0.0',
  category: 'TOKENS',
  icon: '◆',
  description: 'Emit a single token to any module that takes one.',
  permission: 'READ_ONLY',
  inputs: [],
  outputs: [
    { id: 'token', label: 'TOKEN', type: 'token' },
    { id: 'price', label: 'PRICE', type: 'price' },
  ],
  defaultSize: { width: 240, height: 150 },
  minSize: { width: 200, height: 120 },
  defaultConfig: { symbol: 'HEX' },
  keywords: ['token', 'asset', 'pick'],
});

export const priceModule = define({
  type: MODULE_TYPES.price,
  name: 'PRICE',
  version: '1.0.0',
  category: 'MARKET',
  icon: '$',
  description: 'Live price, change, volume and liquidity for a token or pair.',
  permission: 'READ_ONLY',
  inputs: [
    { id: 'token', label: 'TOKEN', type: 'token', optional: true },
    { id: 'pair', label: 'PAIR', type: 'pair', optional: true },
  ],
  outputs: [
    { id: 'price', label: 'PRICE', type: 'price' },
    { id: 'change', label: 'CHANGE %', type: 'percent' },
    { id: 'volume', label: 'VOLUME', type: 'number' },
  ],
  defaultSize: { width: 260, height: 160 },
  minSize: { width: 200, height: 120 },
  defaultConfig: { source: 'pair-base' },
  keywords: ['price', 'ticker', 'quote', 'usd'],
});

export const chartModule = define({
  type: MODULE_TYPES.chart,
  name: 'CHART',
  version: '1.0.0',
  category: 'MARKET',
  icon: '▦',
  description: 'Candlestick or line chart with volume, crosshair and zoom.',
  permission: 'READ_ONLY',
  inputs: [
    { id: 'pair', label: 'PAIR', type: 'pair', optional: true },
    { id: 'timeframe', label: 'TIMEFRAME', type: 'timeframe', optional: true },
  ],
  outputs: [
    { id: 'price', label: 'PRICE', type: 'price' },
    { id: 'change', label: 'CHANGE %', type: 'percent' },
    { id: 'series', label: 'SERIES', type: 'series' },
  ],
  defaultSize: { width: 520, height: 340 },
  minSize: { width: 280, height: 200 },
  defaultConfig: { timeframe: '1h', style: 'candles', showVolume: true },
  flush: true,
  keywords: ['chart', 'candles', 'ohlc', 'graph', 'technical'],
});

export const swapModule = define({
  type: MODULE_TYPES.swap,
  name: 'SWAP TERMINAL',
  version: '1.0.0',
  category: 'TRADING',
  icon: '⇅',
  description: 'Quote, review and execute a swap. Every execution requires explicit confirmation.',
  permission: 'EXECUTION_CAPABLE',
  inputs: [
    { id: 'pair', label: 'PAIR', type: 'pair', optional: true },
    { id: 'tokenA', label: 'SELL TOKEN', type: 'token', optional: true },
    { id: 'tokenB', label: 'BUY TOKEN', type: 'token', optional: true },
    { id: 'amount', label: 'AMOUNT', type: 'amount', optional: true },
    { id: 'wallet', label: 'WALLET', type: 'wallet', optional: true },
    { id: 'slippage', label: 'SLIPPAGE', type: 'percent', optional: true },
  ],
  outputs: [
    { id: 'quote', label: 'QUOTE', type: 'quote' },
    { id: 'transaction', label: 'TRANSACTION', type: 'transaction' },
    { id: 'amountOut', label: 'AMOUNT OUT', type: 'amount' },
  ],
  defaultSize: { width: 340, height: 440 },
  minSize: { width: 300, height: 340 },
  defaultConfig: { slippagePct: 0.5, amount: '', adapterId: 'auto' },
  keywords: ['swap', 'trade', 'buy', 'sell', 'execute'],
});

export const quoteComparisonModule = define({
  type: MODULE_TYPES.quoteComparison,
  name: 'QUOTE COMPARISON',
  version: '1.0.0',
  category: 'TRADING',
  icon: '⋔',
  description: 'Compare every venue for the same trade, with impact and route.',
  permission: 'READ_ONLY',
  inputs: [
    { id: 'pair', label: 'PAIR', type: 'pair', optional: true },
    { id: 'amount', label: 'AMOUNT', type: 'amount', optional: true },
  ],
  outputs: [{ id: 'quote', label: 'BEST QUOTE', type: 'quote' }],
  defaultSize: { width: 380, height: 280 },
  minSize: { width: 300, height: 200 },
  defaultConfig: { amount: '1000' },
  keywords: ['routes', 'venues', 'aggregator', 'best price'],
});

export const gasModule = define({
  type: MODULE_TYPES.gas,
  name: 'GAS',
  version: '1.0.0',
  category: 'NETWORK',
  icon: '⛽',
  description: 'Current gas price, block height and estimated swap cost.',
  permission: 'READ_ONLY',
  inputs: [],
  outputs: [
    { id: 'gasGwei', label: 'GWEI', type: 'number' },
    { id: 'block', label: 'BLOCK', type: 'number' },
  ],
  defaultSize: { width: 220, height: 140 },
  minSize: { width: 180, height: 110 },
  defaultConfig: {},
  keywords: ['gwei', 'fee', 'network cost'],
});

export const networkModule = define({
  type: MODULE_TYPES.network,
  name: 'NETWORK STATUS',
  version: '1.0.0',
  category: 'NETWORK',
  icon: '◉',
  description: 'Chain, block, RPC / indexer / router health and data origin.',
  permission: 'READ_ONLY',
  inputs: [],
  outputs: [{ id: 'network', label: 'NETWORK', type: 'network' }],
  defaultSize: { width: 260, height: 200 },
  minSize: { width: 220, height: 160 },
  defaultConfig: {},
  keywords: ['rpc', 'status', 'chain', 'health', 'block'],
});

export const transactionsModule = define({
  type: MODULE_TYPES.transactions,
  name: 'TRANSACTIONS',
  version: '1.0.0',
  category: 'WALLET',
  icon: '≡',
  description: 'Transaction feed with type, status, value and hash.',
  permission: 'READ_ONLY',
  inputs: [
    { id: 'wallet', label: 'WALLET', type: 'wallet', optional: true },
    { id: 'transaction', label: 'TX', type: 'transaction', optional: true },
  ],
  outputs: [{ id: 'latest', label: 'LATEST', type: 'transaction' }],
  defaultSize: { width: 560, height: 220 },
  minSize: { width: 320, height: 140 },
  defaultConfig: { filter: 'all' },
  flush: true,
  keywords: ['feed', 'history', 'tx', 'activity'],
});

export const calculatorModule = define({
  type: MODULE_TYPES.calculator,
  name: 'CALCULATOR',
  version: '1.0.0',
  category: 'ANALYTICS',
  icon: '%',
  description: 'Take a number in, apply an operation, emit the result — e.g. 25% of a balance into a swap.',
  permission: 'READ_ONLY',
  inputs: [
    { id: 'value', label: 'VALUE', type: 'number', optional: true },
    { id: 'operand', label: 'OPERAND', type: 'number', optional: true },
  ],
  outputs: [{ id: 'result', label: 'RESULT', type: 'number' }],
  defaultSize: { width: 280, height: 220 },
  minSize: { width: 230, height: 180 },
  defaultConfig: { operation: 'percent', operand: 25, manualValue: 0 },
  keywords: ['percent', 'multiply', 'divide', 'roi', 'maths'],
});

export const alertModule = define({
  type: MODULE_TYPES.alert,
  name: 'ALERT',
  version: '1.0.0',
  category: 'INTELLIGENCE',
  icon: '!',
  description: 'Watch an incoming value against a threshold and raise a signal. Never trades.',
  permission: 'READ_ONLY',
  inputs: [{ id: 'value', label: 'VALUE', type: 'number', optional: true }],
  outputs: [{ id: 'signal', label: 'SIGNAL', type: 'signal' }],
  defaultSize: { width: 300, height: 250 },
  minSize: { width: 250, height: 200 },
  defaultConfig: { condition: 'PRICE_BELOW', threshold: 0, label: 'PRICE ALERT', ruleId: null },
  keywords: ['alert', 'threshold', 'notify', 'signal', 'trigger'],
});

export const ratioModule = define({
  type: MODULE_TYPES.ratio,
  name: 'PRICE RATIO',
  version: '1.0.0',
  category: 'ANALYTICS',
  icon: '÷',
  description: 'Ratio between two assets with average, high, low and deviation.',
  permission: 'READ_ONLY',
  inputs: [{ id: 'pair', label: 'PAIR', type: 'pair', optional: true }],
  outputs: [
    { id: 'ratio', label: 'RATIO', type: 'ratio' },
    { id: 'deviation', label: 'DEVIATION %', type: 'percent' },
  ],
  defaultSize: { width: 300, height: 220 },
  minSize: { width: 240, height: 170 },
  defaultConfig: { window: 90 },
  keywords: ['ratio', 'relative', 'comparison', 'deviation'],
});

export const liquidityModule = define({
  type: MODULE_TYPES.liquidity,
  name: 'POOL LIQUIDITY',
  version: '1.0.0',
  category: 'LIQUIDITY',
  icon: '≋',
  description: 'Liquidity depth across venues for the linked pair.',
  permission: 'READ_ONLY',
  inputs: [{ id: 'pair', label: 'PAIR', type: 'pair', optional: true }],
  outputs: [{ id: 'liquidity', label: 'TVL', type: 'number' }],
  defaultSize: { width: 300, height: 220 },
  minSize: { width: 240, height: 160 },
  defaultConfig: {},
  keywords: ['tvl', 'pool', 'depth', 'lp'],
});

export const tokenInfoModule = define({
  type: MODULE_TYPES.tokenInfo,
  name: 'TOKEN INFO',
  version: '1.0.0',
  category: 'TOKENS',
  icon: 'ℹ',
  description: 'Contract, decimals, verification state and market stats for a token.',
  permission: 'READ_ONLY',
  inputs: [{ id: 'token', label: 'TOKEN', type: 'token', optional: true }],
  outputs: [{ id: 'token', label: 'TOKEN', type: 'token' }],
  defaultSize: { width: 300, height: 230 },
  minSize: { width: 240, height: 170 },
  defaultConfig: {},
  keywords: ['contract', 'metadata', 'decimals', 'supply'],
});

export const watchlistModule = define({
  type: MODULE_TYPES.watchlist,
  name: 'WATCHLIST',
  version: '1.0.0',
  category: 'SYSTEM',
  icon: '★',
  description: 'Tracked tokens with price and change; selecting one emits it.',
  permission: 'READ_ONLY',
  inputs: [],
  outputs: [{ id: 'token', label: 'SELECTED', type: 'token' }],
  defaultSize: { width: 300, height: 240 },
  minSize: { width: 240, height: 160 },
  defaultConfig: { symbols: ['HEX', 'PLS', 'PLSX', 'INC'] },
  flush: true,
  keywords: ['watch', 'favourites', 'list', 'tokens'],
});

export const whaleWatchModule = define({
  type: MODULE_TYPES.whaleWatch,
  name: 'WHALE WATCH',
  version: '1.0.0',
  category: 'INTELLIGENCE',
  icon: '◍',
  description: 'Large wallet movements with size, token and direction.',
  permission: 'READ_ONLY',
  inputs: [{ id: 'wallet', label: 'WALLET', type: 'wallet', optional: true }],
  outputs: [
    { id: 'movementValue', label: 'VALUE', type: 'number' },
    { id: 'token', label: 'TOKEN', type: 'token' },
  ],
  defaultSize: { width: 420, height: 260 },
  minSize: { width: 300, height: 180 },
  defaultConfig: { minValueUsd: 50000 },
  flush: true,
  keywords: ['whale', 'flows', 'large', 'movements', 'scanner'],
});

export const scannerModule = define({
  type: MODULE_TYPES.scanner,
  name: 'MARKET SCANNER',
  version: '1.0.0',
  category: 'INTELLIGENCE',
  icon: '⌕',
  description: 'Rank the chain’s tokens by change, volume or liquidity.',
  permission: 'READ_ONLY',
  inputs: [],
  outputs: [{ id: 'token', label: 'SELECTED', type: 'token' }],
  defaultSize: { width: 420, height: 280 },
  minSize: { width: 320, height: 180 },
  defaultConfig: { sort: 'change24hPct', direction: 'desc' },
  flush: true,
  keywords: ['scanner', 'movers', 'gainers', 'losers', 'volume'],
});

export const hexStakesModule = define({
  type: MODULE_TYPES.hexStakes,
  name: 'HEX STAKES',
  version: '1.0.0',
  category: 'STAKING',
  icon: '⬢',
  description: 'T-Share pricing and a stake ladder projection for HEX.',
  permission: 'READ_ONLY',
  inputs: [{ id: 'amount', label: 'AMOUNT', type: 'amount', optional: true }],
  outputs: [
    { id: 'tShares', label: 'T-SHARES', type: 'number' },
    { id: 'projectedYield', label: 'YIELD', type: 'number' },
  ],
  defaultSize: { width: 340, height: 300 },
  minSize: { width: 280, height: 220 },
  defaultConfig: { principal: 100000, days: 3650, tShareRate: 24000 },
  keywords: ['hex', 'stake', 'tshare', 't-share', 'ladder', 'yield'],
});

export const activityLogModule = define({
  type: MODULE_TYPES.activityLog,
  name: 'ACTIVITY LOG',
  version: '1.0.0',
  category: 'SYSTEM',
  icon: '⋯',
  description: 'Every system event in order — the deck’s black box recorder.',
  permission: 'READ_ONLY',
  inputs: [],
  outputs: [],
  defaultSize: { width: 380, height: 240 },
  minSize: { width: 280, height: 160 },
  defaultConfig: {},
  flush: true,
  keywords: ['log', 'events', 'debug', 'history'],
});

export const notesModule = define({
  type: MODULE_TYPES.notes,
  name: 'NOTES',
  version: '1.0.0',
  category: 'SYSTEM',
  icon: '✎',
  description: 'Scratch pad stored with the deck.',
  permission: 'READ_ONLY',
  inputs: [],
  outputs: [{ id: 'text', label: 'TEXT', type: 'text' }],
  defaultSize: { width: 260, height: 200 },
  minSize: { width: 200, height: 140 },
  defaultConfig: { text: '' },
  keywords: ['notes', 'scratch', 'memo', 'plan'],
});

export const clockModule = define({
  type: MODULE_TYPES.clock,
  name: 'CLOCK',
  version: '1.0.0',
  category: 'SYSTEM',
  icon: '◷',
  description: 'Local and UTC time with session uptime.',
  permission: 'READ_ONLY',
  inputs: [],
  outputs: [{ id: 'timestamp', label: 'TIME', type: 'number' }],
  defaultSize: { width: 200, height: 130 },
  minSize: { width: 160, height: 100 },
  defaultConfig: {},
  keywords: ['time', 'utc', 'clock'],
});
