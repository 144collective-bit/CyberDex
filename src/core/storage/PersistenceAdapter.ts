/**
 * Storage is an interface, not localStorage.
 *
 * The app only ever talks to this contract, so swapping in an HTTP/account
 * backed adapter later is a wiring change, not a rewrite. All methods are async
 * for exactly that reason.
 */
export interface PersistenceAdapter {
  readonly id: string;
  /**
   * True once writes stopped reaching durable storage. Callers must not report
   * a successful save while this is set.
   */
  readonly degraded?: boolean;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export const STORAGE_KEYS = {
  workspace: 'cyberdex.workspace.v1',
  preferences: 'cyberdex.preferences.v1',
  wallets: 'cyberdex.wallets.v1',
  alerts: 'cyberdex.alerts.v1',
  watchlist: 'cyberdex.watchlist.v1',
  transactions: 'cyberdex.transactions.v1',
  onboarding: 'cyberdex.onboarding.v1',
} as const;
