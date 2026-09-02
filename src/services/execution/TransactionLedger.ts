import type { EventBus } from '../../core/events/bus';
import type { PersistenceAdapter } from '../../core/storage/PersistenceAdapter';
import { STORAGE_KEYS } from '../../core/storage/PersistenceAdapter';
import type { TxRecord, TxStatus } from '../../core/types';

/**
 * The transaction feed's source of truth.
 *
 * Records are kept per wallet + chain, and a record's `simulated` flag travels
 * with it forever so the feed can never present a demo trade as settled.
 */
export class TransactionLedger {
  private records: TxRecord[] = [];
  private listeners = new Set<() => void>();
  private adapter: PersistenceAdapter;
  private bus: EventBus;
  private limit: number;

  constructor(adapter: PersistenceAdapter, bus: EventBus, limit = 200) {
    this.adapter = adapter;
    this.bus = bus;
    this.limit = limit;
  }

  getState = (): TxRecord[] => this.records;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async hydrate(): Promise<void> {
    const stored = await this.adapter.get<TxRecord[]>(STORAGE_KEYS.transactions);
    if (Array.isArray(stored)) {
      this.records = stored;
      this.emit();
    }
  }

  list(filter: { wallet?: string; chainId?: number } = {}): TxRecord[] {
    return this.records.filter((tx) => {
      if (filter.wallet && String(tx.wallet).toLowerCase() !== filter.wallet.toLowerCase()) return false;
      if (filter.chainId !== undefined && tx.chainId !== filter.chainId) return false;
      return true;
    });
  }

  add(record: TxRecord): TxRecord {
    this.records = [record, ...this.records].slice(0, this.limit);
    this.persist();
    this.emit();
    this.bus.emit('TRANSACTION_SUBMITTED', { tx: record }, 'ledger');
    return record;
  }

  update(id: string, patch: Partial<TxRecord>): TxRecord | null {
    const index = this.records.findIndex((tx) => tx.id === id);
    if (index < 0) return null;
    const next = { ...this.records[index]!, ...patch };
    this.records = [...this.records.slice(0, index), next, ...this.records.slice(index + 1)];
    this.persist();
    this.emit();
    return next;
  }

  setStatus(id: string, status: TxStatus, error?: string): TxRecord | null {
    const next = this.update(id, { status, error });
    if (!next) return null;
    if (status === 'CONFIRMED') this.bus.emit('TRANSACTION_CONFIRMED', { tx: next }, 'ledger');
    if (status === 'FAILED' || status === 'REJECTED') this.bus.emit('TRANSACTION_FAILED', { tx: next }, 'ledger');
    return next;
  }

  clear(): void {
    this.records = [];
    this.persist();
    this.emit();
  }

  private persist(): void {
    void this.adapter.set(STORAGE_KEYS.transactions, this.records);
  }

  private emit(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }
}
