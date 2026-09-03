import { describe, expect, it } from 'vitest';
import { EventBus } from '../../core/events/bus';
import { MemoryAdapter } from '../../core/storage/MemoryAdapter';
import { AlertEngine, createAlertRule } from '../alerts/AlertEngine';

describe('alert rule ownership', () => {
  function engine() {
    return new AlertEngine(new MemoryAdapter(), new EventBus());
  }

  it('prunes rules whose owning module is gone', () => {
    const alerts = engine();
    alerts.add(createAlertRule({ name: 'A', type: 'PRICE_ABOVE', subject: 'HEX', threshold: 1, ownerModuleId: 'mod_a' }));
    alerts.add(createAlertRule({ name: 'B', type: 'PRICE_ABOVE', subject: 'HEX', threshold: 1, ownerModuleId: 'mod_b' }));

    const removed = alerts.pruneOrphans(new Set(['mod_b']));
    expect(removed).toHaveLength(1);
    expect(alerts.getState().map((rule) => rule.name)).toEqual(['B']);
  });

  it('never prunes rules created by hand from the alerts page', () => {
    const alerts = engine();
    alerts.add(createAlertRule({ name: 'MANUAL', type: 'PRICE_BELOW', subject: 'PLS', threshold: 1 }));
    expect(alerts.pruneOrphans(new Set())).toHaveLength(0);
    expect(alerts.getState()).toHaveLength(1);
  });

  it('reports the rules a module owns', () => {
    const alerts = engine();
    alerts.add(createAlertRule({ name: 'A', type: 'PRICE_ABOVE', subject: 'HEX', threshold: 1, ownerModuleId: 'mod_a' }));
    expect(alerts.ownedBy('mod_a')).toHaveLength(1);
    expect(alerts.ownedBy('mod_z')).toHaveLength(0);
  });

  it('a pruned rule can no longer fire', () => {
    const bus = new EventBus();
    const alerts = new AlertEngine(new MemoryAdapter(), bus);
    const rule = alerts.add(
      createAlertRule({ name: 'A', type: 'PRICE_ABOVE', subject: 'HEX', threshold: 1, ownerModuleId: 'mod_a' }),
    );
    expect(alerts.evaluate(rule.id, 5).triggered).toBe(true);
    alerts.pruneOrphans(new Set());
    expect(alerts.evaluate(rule.id, 5).reason).toBe('Unknown alert');
  });
});
