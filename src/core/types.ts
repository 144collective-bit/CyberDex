/**
 * CYBER DEX — shared domain types.
 *
 * These types are deliberately provider-agnostic: nothing here knows whether a
 * price came from a live indexer or the demo adapter. Provenance is carried on
 * the value (`simulated`, `source`) so the UI can label it honestly.
 */

export type Address = `0x${string}` | string;

export interface TokenRef {
  /** Contract address, or the sentinel `native` for a chain's gas token. */
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
  /** Accent used by charts/allocation bars so tokens stay visually stable. */
  color?: string;
  verified?: boolean;
  tags?: string[];
}

export interface PairRef {
  /** Deterministic id: `${chainId}:${baseAddress}/${quoteAddress}` */
  id: string;
  base: TokenRef;
  quote: TokenRef;
  label: string;
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface TokenMarket {
  token: TokenRef;
  priceUsd: number;
  change24hPct: number;
  change7dPct: number;
  volume24hUsd: number;
  liquidityUsd: number;
  marketCapUsd: number;
  updatedAt: number;
  simulated: boolean;
}

export interface TokenBalance {
  token: TokenRef;
  /** Base-unit string, kept exact. */
  raw: string;
  /** Human amount — derived, may lose precision for display only. */
  amount: number;
  valueUsd: number;
}

export interface PortfolioSnapshot {
  address: Address;
  chainId: number;
  totalValueUsd: number;
  change24hPct: number;
  change7dPct: number;
  holdings: TokenBalance[];
  updatedAt: number;
  simulated: boolean;
}

export type WalletKind = 'injected' | 'demo' | 'watch';

export interface WalletRecord {
  id: string;
  address: Address;
  label: string;
  chainId: number;
  kind: WalletKind;
  /** A watch wallet can never sign. */
  watchOnly: boolean;
  addedAt: number;
}

export type TxType =
  | 'SWAP'
  | 'APPROVAL'
  | 'SEND'
  | 'RECEIVE'
  | 'STAKE'
  | 'UNSTAKE'
  | 'LP_ADD'
  | 'LP_REMOVE';

export type TxStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REJECTED';

export interface TxRecord {
  id: string;
  hash: string | null;
  wallet: Address;
  chainId: number;
  type: TxType;
  status: TxStatus;
  timestamp: number;
  summary: string;
  /** True when produced by the demo adapter. Never rendered as a real tx. */
  simulated: boolean;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface GasSnapshot {
  chainId: number;
  baseFeeGwei: number;
  priorityFeeGwei: number;
  blockNumber: number;
  blockTimeSec: number;
  updatedAt: number;
  simulated: boolean;
}

export interface NetworkInfo {
  chainId: number;
  name: string;
  shortName: string;
  nativeSymbol: string;
  explorerUrl: string;
  demo: boolean;
}

export type ServiceHealth = 'online' | 'degraded' | 'offline' | 'unknown';

export interface SystemStatus {
  rpc: ServiceHealth;
  indexer: ServiceHealth;
  router: ServiceHealth;
  lastCheck: number;
}

export interface RouteLeg {
  dex: string;
  portionPct: number;
  path: string[];
}

export type QuoteWarningCode =
  | 'HIGH_PRICE_IMPACT'
  | 'LOW_LIQUIDITY'
  | 'EXTREME_SLIPPAGE'
  | 'UNVERIFIED_TOKEN'
  | 'SIMULATION_FAILED'
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_GAS'
  | 'APPROVAL_REQUIRED'
  | 'UNSUPPORTED_NETWORK';

export interface QuoteWarning {
  code: QuoteWarningCode;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface Quote {
  id: string;
  adapterId: string;
  adapterLabel: string;
  source: TokenRef;
  dest: TokenRef;
  amountIn: number;
  amountOut: number;
  minAmountOut: number;
  priceImpactPct: number;
  slippagePct: number;
  gasEstimate: number;
  gasCostUsd: number;
  route: RouteLeg[];
  warnings: QuoteWarning[];
  createdAt: number;
  simulated: boolean;
}

export interface TradeIntent {
  source: TokenRef;
  dest: TokenRef;
  amountIn: number;
  slippagePct: number;
  wallet: WalletRecord | null;
  chainId: number;
}

export interface WhaleMovement {
  id: string;
  wallet: Address;
  label?: string;
  direction: 'IN' | 'OUT';
  token: TokenRef;
  amount: number;
  valueUsd: number;
  timestamp: number;
  hash: string;
  simulated: boolean;
}

export type DataOrigin = 'live' | 'demo';
