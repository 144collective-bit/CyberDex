import type { EventBus } from '../../core/events/bus';
import type { PersistenceAdapter } from '../../core/storage/PersistenceAdapter';
import { STORAGE_KEYS } from '../../core/storage/PersistenceAdapter';

export type AlertConditionType =
  | 'PRICE_ABOVE'
  | 'PRICE_BELOW'
  | 'PERCENT_CHANGE_ABOVE'
  | 'PERCENT_CHANGE_BELOW'
  | 'RATIO_ABOVE'
  | 'RATIO_BELOW'
  | 'LIQUIDITY_BELOW'
  | 'PORTFOLIO_ABOVE'
  | 'PORTFOLIO_BELOW'
  | 'WHALE_VALUE_ABOVE';

export interface AlertRule {
  id: string;
  name: string;
  type: AlertConditionType;
  /** What the value describes: a token symbol, pair label, or wallet label. */
  subject: string;
  threshold: number;
  enabled: boolean;
  /** Minimum gap between firings so a hovering price cannot spam the user. */
  cooldownMs: number;
  lastTriggered: number | null;
  createdAt: number;
  /** Alerts never trade. This is a hard product rule, recorded on the model. */
  readonly action: 'NOTIFY';
}

export interface AlertEvaluation {
  triggered: boolean;
  reason: string;
}

let seq = 0;

export function createAlertRule(input: Partial<AlertRule> & { name: string; type: AlertConditionType; subject: string; threshold: number }): AlertRule {
  return {
    id: input.id ?? `alt_${Date.now().toString(36)}_${(seq++).toString(36)}`,
    name: input.name,
    type: input.type,
    subject: input.subject,
    threshold: input.threshold,
    enabled: input.enabled ?? true,
    cooldownMs: input.cooldownMs ?? 60_000,
    lastTriggered: input.lastTriggered ?? null,
    createdAt: input.createdAt ?? Date.now(),
    action: 'NOTIFY',
  };
}

/** Pure condition check — no side effects, directly unit-testable. */
export function checkCondition(type: AlertConditionType, value: number, threshold: number): boolean {
  switch (type) {
    case 'PRICE_ABOVE':
    case 'RATIO_ABOVE':
    case 'PERCENT_CHANGE_ABOVE':
    case 'PORTFOLIO_ABOVE':
    case 'WHALE_VALUE_ABOVE':
      return value > threshold;
    case 'PRICE_BELOW':
    case 'RATIO_BELOW':
    case 'PERCENT_CHANGE_BELOW':
    case 'PORTFOLIO_BELOW':
    case 'LIQUIDITY_BELOW':
      return value < threshold;
    default:
      return false;
  }
}

export function describeCondition(rule: Pick<AlertRule, 'type' | 'subject' | 'threshold'>): string {
  const comparator = checkCondition(rule.type, Infinity, 0) ? '>' : '<';
  return `${rule.subject} ${comparator} ${rule.threshold}`;
}

/**
 * Holds alert rules and evaluates values pushed at it by modules.
 *
 * The engine only ever emits ALERT_TRIGGERED. It has no path to execution:
 * automated trading is a deliberate future feature, not an emergent one.
 */
export class AlertEngine {
  private rules: AlertRule[] = [];
  private listeners = new Set<() => void>();
  private adapter: PersistenceAdapter;
  private bus: EventBus;

  constructor(adapter: PersistenceAdapter, bus: EventBus) {
    this.adapter = adapter;
    this.bus = bus;
  }

  getState = (): AlertRule[] => this.rules;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async hydrate(): Promise<void> {
    const stored = await this.adapter.get<AlertRule[]>(STORAGE_KEYS.alerts);
    if (Array.isArray(stored)) {
      this.rules = stored.map((rule) => ({ ...rule, action: 'NOTIFY' as const }));
      this.emit();
    }
  }

  add(rule: AlertRule): AlertRule {
    this.rules = [...this.rules, rule];
    this.persist();
    this.emit();
    return rule;
  }

  update(id: string, patch: Partial<AlertRule>): void {
    this.rules = this.rules.map((rule) => (rule.id === id ? { ...rule, ...patch, action: 'NOTIFY' } : rule));
    this.persist();
    this.emit();
  }

  remove(id: string): void {
    this.rules = this.rules.filter((rule) => rule.id !== id);
    this.persist();
    this.emit();
  }

  get(id: string): AlertRule | undefined {
    return this.rules.find((rule) => rule.id === id);
  }

  /** Push a value at one rule. Returns whether it fired. */
  evaluate(id: string, value: number, detail?: string): AlertEvaluation {
    const rule = this.get(id);
    if (!rule) return { triggered: false, reason: 'Unknown alert' };
    if (!rule.enabled) return { triggered: false, reason: 'Alert disabled' };
    if (!Number.isFinite(value)) return { triggered: false, reason: 'No value yet' };
    if (rule.lastTriggered && Date.now() - rule.lastTriggered < rule.cooldownMs) {
      return { triggered: false, reason: 'Cooling down' };
    }
    if (!checkCondition(rule.type, value, rule.threshold)) {
      return { triggered: false, reason: 'Condition not met' };
    }

    this.update(id, { lastTriggered: Date.now() });
    const message = detail ?? `${describeCondition(rule)} (now ${formatValue(value)})`;
    this.bus.emit('ALERT_TRIGGERED', { alertId: rule.id, title: rule.name, detail: message, value }, 'alert-engine');
    return { triggered: true, reason: message };
  }

  private persist(): void {
    void this.adapter.set(STORAGE_KEYS.alerts, this.rules);
  }

  private emit(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toPrecision(4);
}
