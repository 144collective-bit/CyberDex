import type {
  GasSnapshot,
  PairRef,
  PortfolioSnapshot,
  Quote,
  TokenMarket,
  TokenRef,
  TxRecord,
  WalletRecord,
  WhaleMovement,
} from '../types';

/**
 * The system event contract. Modules publish and subscribe against these names
 * only — nothing subscribes to another module directly.
 */
export interface SystemEventMap {
  PAIR_CHANGED: { pair: PairRef };
  TOKEN_CHANGED: { token: TokenRef };
  TOKEN_SELECTED: { token: TokenRef; source: string };
  WALLET_CHANGED: { wallet: WalletRecord | null };
  WALLET_CONNECTED: { wallet: WalletRecord };
  WALLET_DISCONNECTED: { address: string };
  NETWORK_CHANGED: { chainId: number };
  PRICE_UPDATED: { token: TokenRef; market: TokenMarket };
  BALANCE_UPDATED: { address: string; chainId: number };
  PORTFOLIO_UPDATED: { snapshot: PortfolioSnapshot };
  QUOTE_UPDATED: { quote: Quote };
  QUOTE_FAILED: { reason: string };
  TRADE_REVIEWED: { quote: Quote };
  TRADE_CREATED: { quote: Quote };
  TRANSACTION_SUBMITTED: { tx: TxRecord };
  TRANSACTION_CONFIRMED: { tx: TxRecord };
  TRANSACTION_FAILED: { tx: TxRecord };
  ALERT_TRIGGERED: { alertId: string; title: string; detail: string; value?: number };
  GAS_UPDATED: { gas: GasSnapshot };
  WHALE_MOVEMENT: { movement: WhaleMovement };
  DECK_SAVED: { deckId: string; name: string };
  DECK_LOADED: { deckId: string; name: string };
  MODULE_ADDED: { moduleId: string; type: string };
  MODULE_REMOVED: { moduleId: string };
  LINK_CREATED: { connectionId: string; from: string; to: string };
  LINK_REMOVED: { connectionId: string };
  SYSTEM_NOTICE: { level: 'info' | 'warning' | 'error'; message: string };
}

export type SystemEventName = keyof SystemEventMap;

export interface EventRecord<K extends SystemEventName = SystemEventName> {
  id: string;
  type: K;
  payload: SystemEventMap[K];
  at: number;
  /** Module id or service name that emitted it. */
  origin: string;
}
