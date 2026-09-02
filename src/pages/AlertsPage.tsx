import { useState } from 'react';
import { createAlertRule, describeCondition } from '../services/alerts/AlertEngine';
import type { AlertConditionType } from '../services/alerts/AlertEngine';
import { useAlertRules, useSystem } from '../state/system';
import { formatRelative } from '../utils/format';

const CONDITIONS: AlertConditionType[] = [
  'PRICE_ABOVE',
  'PRICE_BELOW',
  'PERCENT_CHANGE_ABOVE',
  'PERCENT_CHANGE_BELOW',
  'RATIO_ABOVE',
  'RATIO_BELOW',
  'LIQUIDITY_BELOW',
  'PORTFOLIO_ABOVE',
  'PORTFOLIO_BELOW',
  'WHALE_VALUE_ABOVE',
];

export function AlertsPage() {
  const system = useSystem();
  const rules = useAlertRules();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('HEX');
  const [type, setType] = useState<AlertConditionType>('PRICE_BELOW');
  const [threshold, setThreshold] = useState('0');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>ALERTS</h1>
          <p className="faint">
            Alerts notify. They never place a trade — automation stays an explicit, opt-in feature.
          </p>
        </div>
      </div>

      <section className="card">
        <h2>NEW ALERT</h2>
        <div className="row wrap" style={{ gap: 'var(--space-3)' }}>
          <input
            className="input"
            style={{ maxWidth: 200 }}
            placeholder="ALERT NAME"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className="input"
            style={{ maxWidth: 140 }}
            placeholder="SUBJECT (HEX, HEX/PLS…)"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
          <select className="select" style={{ maxWidth: 220 }} value={type} onChange={(event) => setType(event.target.value as AlertConditionType)}>
            {CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {condition.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <input
            className="input mono-num"
            style={{ maxWidth: 140 }}
            inputMode="decimal"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value.replace(/[^0-9.\-]/g, ''))}
          />
          <button
            type="button"
            className="btn"
            data-variant="primary"
            disabled={!name.trim()}
            onClick={() => {
              system.alerts.add(
                createAlertRule({ name: name.trim(), subject, type, threshold: Number(threshold) || 0 }),
              );
              setName('');
            }}
          >
            CREATE
          </button>
        </div>
        <p className="faint" style={{ fontSize: 'var(--text-3xs)', margin: 0 }}>
          Alerts created here can be driven by an Alert module on any deck — wire a price, ratio or calculator output
          into its VALUE port.
        </p>
      </section>

      <section className="col">
        <h2>RULES</h2>
        <div className="card" style={{ padding: 0 }}>
          <table className="dtable">
            <thead>
              <tr>
                <th>NAME</th>
                <th>CONDITION</th>
                <th>STATE</th>
                <th>LAST TRIGGERED</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.name}</td>
                  <td className="mono-num">{describeCondition(rule)}</td>
                  <td>
                    <span className="chip" data-tone={rule.enabled ? 'success' : undefined}>
                      {rule.enabled ? 'ARMED' : 'DISABLED'}
                    </span>
                  </td>
                  <td className="faint">
                    {rule.lastTriggered ? `${formatRelative(rule.lastTriggered)} ago` : 'NEVER'}
                  </td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                      <button
                        type="button"
                        className="btn"
                        data-variant="ghost"
                        onClick={() => system.alerts.update(rule.id, { enabled: !rule.enabled })}
                      >
                        {rule.enabled ? 'DISARM' : 'ARM'}
                      </button>
                      <button type="button" className="icon-btn" aria-label="Delete alert" onClick={() => system.alerts.remove(rule.id)}>
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty">
                      <h5>NO ALERTS</h5>
                      <p>Create a rule above, or drop an Alert module onto a deck and wire a value into it.</p>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
