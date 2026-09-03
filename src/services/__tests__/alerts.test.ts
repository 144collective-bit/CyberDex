import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/events/bus';
import { MemoryAdapter } from '../../core/storage/MemoryAdapter';
import { AlertEngine, checkCondition, createAlertRule, describeCondition } from '../alerts/AlertEngine';
import { NotificationCenter } from '../notifications/NotificationCenter';

describe('alert conditions', () => {
  it('compares in the right direction for each condition', () => {
    expect(checkCondition('PRICE_ABOVE', 10, 5)).toBe(true);
    expect(checkCondition('PRICE_ABOVE', 4, 5)).toBe(false);
    expect(checkCondition('PRICE_BELOW', 4, 5)).toBe(true);
    expect(checkCondition('RATIO_BELOW', 0.4, 0.5)).toBe(true);
    expect(checkCondition('WHALE_VALUE_ABOVE', 300_000, 250_000)).toBe(true);
  });

  it('describes a rule readably', () => {
    expect(describeCondition({ type: 'PRICE_BELOW', subject: 'HEX', threshold: 0.003 })).toBe('HEX < 0.003');
  });
});

describe('AlertEngine', () => {
  function engine() {
    const bus = new EventBus();
    return { bus, alerts: new AlertEngine(new MemoryAdapter(), bus) };
  }

  it('fires once and then holds off during the cooldown', () => {
    const { bus, alerts } = engine();
    const triggered = vi.fn();
    bus.on('ALERT_TRIGGERED', triggered);
    const rule = alerts.add(
      createAlertRule({ name: 'HEX FLOOR', type: 'PRICE_BELOW', subject: 'HEX', threshold: 0.005, cooldownMs: 60_000 }),
    );

    expect(alerts.evaluate(rule.id, 0.004).triggered).toBe(true);
    expect(alerts.evaluate(rule.id, 0.003).triggered).toBe(false);
    expect(triggered).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the condition is not met or the rule is disarmed', () => {
    const { alerts } = engine();
    const rule = alerts.add(
      createAlertRule({ name: 'X', type: 'PRICE_ABOVE', subject: 'HEX', threshold: 1 }),
    );
    expect(alerts.evaluate(rule.id, 0.5).reason).toBe('Condition not met');
    alerts.update(rule.id, { enabled: false });
    expect(alerts.evaluate(rule.id, 5).reason).toBe('Alert disabled');
  });

  it('ignores non-finite values', () => {
    const { alerts } = engine();
    const rule = alerts.add(createAlertRule({ name: 'X', type: 'PRICE_ABOVE', subject: 'HEX', threshold: 1 }));
    expect(alerts.evaluate(rule.id, Number.NaN).triggered).toBe(false);
  });

  it('only ever notifies — rules carry no execution action', () => {
    const { alerts } = engine();
    const rule = alerts.add(createAlertRule({ name: 'X', type: 'PRICE_ABOVE', subject: 'HEX', threshold: 1 }));
    expect(rule.action).toBe('NOTIFY');
    expect(Object.keys(rule)).not.toContain('trade');
  });

  it('persists rules across a restart', async () => {
    const adapter = new MemoryAdapter();
    const first = new AlertEngine(adapter, new EventBus());
    first.add(createAlertRule({ name: 'KEEP ME', type: 'PRICE_BELOW', subject: 'PLS', threshold: 0.00001 }));
    const second = new AlertEngine(adapter, new EventBus());
    await second.hydrate();
    expect(second.getState()[0]?.name).toBe('KEEP ME');
  });
});

describe('NotificationCenter', () => {
  it('turns system events into notifications', () => {
    const bus = new EventBus();
    const center = new NotificationCenter(bus);
    bus.emit('ALERT_TRIGGERED', { alertId: 'a', title: 'HEX FLOOR', detail: 'HEX < 0.005' });
    expect(center.getState()[0]?.kind).toBe('alert');
    expect(center.getState()[0]?.ttlMs).toBe(0);
  });

  it('labels a simulated transaction distinctly from a live one', () => {
    const bus = new EventBus();
    const center = new NotificationCenter(bus);
    const tx = {
      id: 't',
      hash: 'sim:t',
      wallet: '0x1',
      chainId: 369,
      type: 'SWAP' as const,
      status: 'CONFIRMED' as const,
      timestamp: Date.now(),
      summary: 'Swap HEX → PLS',
      simulated: true,
    };
    bus.emit('TRANSACTION_CONFIRMED', { tx });
    expect(center.getState()[0]?.title).toBe('SIMULATED TX CONFIRMED');
    bus.emit('TRANSACTION_CONFIRMED', { tx: { ...tx, simulated: false } });
    expect(center.getState()[0]?.title).toBe('TRANSACTION CONFIRMED');
  });

  it('keeps a dismissed toast in the notification centre', () => {
    const center = new NotificationCenter();
    const notification = center.push({ kind: 'error', title: 'LIVE FEED UNAVAILABLE' });
    expect(center.active()).toHaveLength(1);

    center.dismiss(notification.id);
    // The toast is gone…
    expect(center.active()).toHaveLength(0);
    // …but the record survives, which is the whole point of a centre.
    expect(center.getState()).toHaveLength(1);
    expect(center.getState()[0]?.dismissedAt).toBeTypeOf('number');
  });

  it('clears everything on request', () => {
    const center = new NotificationCenter();
    center.push({ kind: 'info', title: 'ONE' });
    center.clear();
    expect(center.getState()).toHaveLength(0);
  });

  it('tracks unread counts and clears', () => {
    const center = new NotificationCenter();
    center.push({ kind: 'info', title: 'ONE' });
    center.push({ kind: 'info', title: 'TWO' });
    expect(center.unreadCount()).toBe(2);
    center.markAllRead();
    expect(center.unreadCount()).toBe(0);
    center.clear();
    expect(center.getState()).toHaveLength(0);
  });
});
