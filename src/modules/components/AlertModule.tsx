import { useEffect, useRef, useState } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import { Stat, Warning } from '../../components/ui/States';
import type { AlertConditionType } from '../../services/alerts/AlertEngine';
import { createAlertRule } from '../../services/alerts/AlertEngine';
import { useSystem } from '../../state/system';
import { useModuleConfig, useModuleInputs, useModuleOutputs } from '../../state/moduleIO';
import { formatAmount, formatRelative } from '../../utils/format';

interface Config extends Record<string, unknown> {
  condition: AlertConditionType;
  threshold: number;
  label: string;
  ruleId: string | null;
}

const CONDITIONS: { id: AlertConditionType; label: string }[] = [
  { id: 'PRICE_ABOVE', label: 'VALUE ABOVE' },
  { id: 'PRICE_BELOW', label: 'VALUE BELOW' },
  { id: 'PERCENT_CHANGE_ABOVE', label: 'CHANGE % ABOVE' },
  { id: 'PERCENT_CHANGE_BELOW', label: 'CHANGE % BELOW' },
  { id: 'RATIO_ABOVE', label: 'RATIO ABOVE' },
  { id: 'RATIO_BELOW', label: 'RATIO BELOW' },
  { id: 'PORTFOLIO_ABOVE', label: 'PORTFOLIO ABOVE' },
  { id: 'WHALE_VALUE_ABOVE', label: 'WHALE VALUE ABOVE' },
];

/**
 * Watches whatever value is wired into it. It raises signals and notifications
 * only — an alert has no path to execution by design.
 */
export function Component({ module }: { module: ModuleInstance }) {
  const system = useSystem();
  const inputs = useModuleInputs(module.id);
  const [config, setConfig] = useModuleConfig<Config>(module.id, module.configuration as Config);
  const [lastSignal, setLastSignal] = useState<{ at: number; value: number } | null>(null);
  const ruleIdRef = useRef<string | null>(config.ruleId);

  const value = inputs.value as number | undefined;

  // One engine rule per module instance, created on first render and kept in sync.
  useEffect(() => {
    if (ruleIdRef.current && system.alerts.get(ruleIdRef.current)) {
      system.alerts.update(ruleIdRef.current, {
        name: config.label,
        type: config.condition,
        threshold: config.threshold,
        subject: module.name,
      });
      return;
    }
    const rule = system.alerts.add(
      createAlertRule({
        name: config.label,
        type: config.condition,
        subject: module.name,
        threshold: config.threshold,
      }),
    );
    ruleIdRef.current = rule.id;
    setConfig({ ruleId: rule.id });
  }, [system, config.label, config.condition, config.threshold, module.name, setConfig]);

  useEffect(() => {
    const ruleId = ruleIdRef.current;
    if (!ruleId || value === undefined || !Number.isFinite(value)) return;
    const result = system.alerts.evaluate(ruleId, value);
    if (result.triggered) setLastSignal({ at: Date.now(), value });
  }, [system, value]);

  useModuleOutputs(module.id, {
    signal: lastSignal ? { at: lastSignal.at, value: lastSignal.value, label: config.label } : null,
  });

  return (
    <>
      <input
        className="input"
        value={config.label}
        onChange={(event) => setConfig({ label: event.target.value })}
        aria-label="Alert name"
      />

      <div className="col" style={{ gap: 2 }}>
        <span className="label">CONDITION</span>
        <select
          className="select"
          value={config.condition}
          onChange={(event) => setConfig({ condition: event.target.value as AlertConditionType })}
        >
          {CONDITIONS.map((condition) => (
            <option key={condition.id} value={condition.id}>
              {condition.label}
            </option>
          ))}
        </select>
      </div>

      <div className="col" style={{ gap: 2 }}>
        <span className="label">THRESHOLD</span>
        <input
          className="input mono-num"
          inputMode="decimal"
          value={String(config.threshold)}
          onChange={(event) => setConfig({ threshold: Number(event.target.value.replace(/[^0-9.\-]/g, '')) || 0 })}
        />
      </div>

      <div className="divider" />
      <div className="row wrap" style={{ gap: 'var(--space-6)' }}>
        <Stat label="INCOMING" value={value === undefined ? 'NO LINK' : formatAmount(value)} size="sm" />
        <Stat
          label="STATE"
          value={lastSignal ? 'TRIGGERED' : value === undefined ? 'IDLE' : 'ARMED'}
          tone={lastSignal ? 'down' : undefined}
          size="sm"
          sub={lastSignal ? `${formatRelative(lastSignal.at)} ago` : undefined}
        />
      </div>

      {value === undefined ? (
        <Warning tone="info">Link a price, ratio or calculator output into VALUE to arm this alert.</Warning>
      ) : null}
      <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>
        Alerts notify. They never place a trade.
      </span>
    </>
  );
}
