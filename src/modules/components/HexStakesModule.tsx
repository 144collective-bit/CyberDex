import { useMemo } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import { Stat } from '../../components/ui/States';
import { findToken } from '../../services/market/tokens';
import { useGlobalContext } from '../../state/system';
import { useTokenMarket } from '../../state/marketHooks';
import { useModuleConfig, useModuleInputs, useModuleOutputs } from '../../state/moduleIO';
import { formatAmount, formatUsd } from '../../utils/format';

interface Config extends Record<string, unknown> {
  principal: number;
  days: number;
  tShareRate: number;
}

/**
 * HEX stake projection.
 *
 * Uses the published longer-pays-better / bigger-pays-better shape. Outputs are
 * projections from user inputs, not chain reads — labelled as such in the UI.
 */
export function projectStake(principal: number, days: number, tShareRate: number) {
  const longerPaysBetter = Math.min(days, 3640) / 1820; // caps at 2x for ~10y
  const biggerPaysBetter = Math.min(principal / 150_000_000, 0.1);
  const bonusHearts = principal * (longerPaysBetter + biggerPaysBetter);
  const effective = principal + bonusHearts;
  const tShares = tShareRate > 0 ? effective / tShareRate : 0;
  // Illustrative payout band: ~8%/yr on staked principal at current T-share price.
  const projectedYield = tShares * (days / 365) * 1000;
  return { tShares, projectedYield, bonusHearts, effective };
}

export function Component({ module }: { module: ModuleInstance }) {
  const inputs = useModuleInputs(module.id);
  const [global] = useGlobalContext();
  const [config, setConfig] = useModuleConfig<Config>(module.id, module.configuration as Config);

  const hex = findToken(global.chainId, 'HEX');
  const market = useTokenMarket(hex ?? null);

  const linkedAmount = inputs.amount as number | undefined;
  const principal = linkedAmount ?? config.principal;
  const projection = useMemo(
    () => projectStake(principal, config.days, config.tShareRate),
    [principal, config.days, config.tShareRate],
  );

  useModuleOutputs(module.id, {
    tShares: projection.tShares,
    projectedYield: projection.projectedYield,
  });

  const ladder = [365, 1095, 1825, 3650].map((days) => ({
    days,
    ...projectStake(principal, days, config.tShareRate),
  }));

  return (
    <>
      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <div className="col grow" style={{ gap: 2 }}>
          <span className="label">PRINCIPAL (HEX)</span>
          <input
            className="input mono-num"
            inputMode="decimal"
            value={String(principal)}
            disabled={linkedAmount !== undefined}
            onChange={(event) => setConfig({ principal: Number(event.target.value.replace(/[^0-9.]/g, '')) || 0 })}
          />
        </div>
        <div className="col" style={{ gap: 2, width: 92 }}>
          <span className="label">DAYS</span>
          <input
            className="input mono-num"
            inputMode="numeric"
            value={String(config.days)}
            onChange={(event) => setConfig({ days: Number(event.target.value.replace(/[^0-9]/g, '')) || 0 })}
          />
        </div>
      </div>

      <div className="row wrap" style={{ gap: 'var(--space-6)' }}>
        <Stat label="T-SHARES" value={projection.tShares.toFixed(3)} size="md" />
        <Stat label="BONUS HEARTS" value={formatAmount(projection.bonusHearts)} size="sm" />
        <Stat
          label="PRINCIPAL VALUE"
          value={formatUsd(principal * (market?.priceUsd ?? 0), { compact: true })}
          size="sm"
        />
      </div>

      <div className="divider" />
      <span className="label">STAKE LADDER</span>
      <table className="dtable">
        <thead>
          <tr>
            <th>TERM</th>
            <th className="num">T-SHARES</th>
            <th className="num">EFFECTIVE</th>
          </tr>
        </thead>
        <tbody>
          {ladder.map((rung) => (
            <tr key={rung.days}>
              <td>{Math.round(rung.days / 365)}Y · {rung.days}D</td>
              <td className="num mono-num">{rung.tShares.toFixed(3)}</td>
              <td className="num mono-num">{formatAmount(rung.effective)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>
        Projection from your inputs at a {config.tShareRate.toLocaleString()} T-share rate — not a chain read.
      </span>
    </>
  );
}
