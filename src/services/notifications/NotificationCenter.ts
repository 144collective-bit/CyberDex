import type { EventBus } from '../../core/events/bus';

export type NotificationKind = 'info' | 'success' | 'warning' | 'error' | 'alert' | 'transaction';

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  detail?: string;
  at: number;
  read: boolean;
  /** Auto-dismiss from the toast stack after this many ms (0 = sticky). */
  ttlMs: number;
}

let seq = 0;

export class NotificationCenter {
  private items: Notification[] = [];
  private listeners = new Set<() => void>();
  private limit: number;

  constructor(bus?: EventBus, limit = 60) {
    this.limit = limit;
    if (bus) this.bind(bus);
  }

  /** Wire system events that always deserve a notification. */
  private bind(bus: EventBus): void {
    bus.on('TRANSACTION_SUBMITTED', ({ tx }) =>
      this.push({
        kind: 'transaction',
        title: tx.simulated ? 'SIMULATED TX SUBMITTED' : 'TRANSACTION SUBMITTED',
        detail: tx.summary,
      }),
    );
    bus.on('TRANSACTION_CONFIRMED', ({ tx }) =>
      this.push({
        kind: 'success',
        title: tx.simulated ? 'SIMULATED TX CONFIRMED' : 'TRANSACTION CONFIRMED',
        detail: tx.summary,
      }),
    );
    bus.on('TRANSACTION_FAILED', ({ tx }) =>
      this.push({ kind: 'error', title: 'TRANSACTION FAILED', detail: tx.error ?? tx.summary, ttlMs: 0 }),
    );
    bus.on('ALERT_TRIGGERED', ({ title, detail }) =>
      this.push({ kind: 'alert', title, detail, ttlMs: 0 }),
    );
    bus.on('SYSTEM_NOTICE', ({ level, message }) =>
      this.push({ kind: level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info', title: message }),
    );
  }

  getState = (): Notification[] => this.items;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  push(input: Omit<Notification, 'id' | 'at' | 'read' | 'ttlMs'> & { ttlMs?: number }): Notification {
    const notification: Notification = {
      id: `ntf_${Date.now().toString(36)}_${(seq++).toString(36)}`,
      at: Date.now(),
      read: false,
      ttlMs: input.ttlMs ?? 6000,
      ...input,
    };
    this.items = [notification, ...this.items].slice(0, this.limit);
    this.emit();
    return notification;
  }

  dismiss(id: string): void {
    const next = this.items.filter((n) => n.id !== id);
    if (next.length === this.items.length) return;
    this.items = next;
    this.emit();
  }

  markAllRead(): void {
    if (!this.items.some((n) => !n.read)) return;
    this.items = this.items.map((n) => ({ ...n, read: true }));
    this.emit();
  }

  clear(): void {
    if (!this.items.length) return;
    this.items = [];
    this.emit();
  }

  unreadCount(): number {
    return this.items.filter((n) => !n.read).length;
  }

  private emit(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }
}
