import { useEffect, useState } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import type { WhaleMovement } from '../../core/types';
import { LoadingState } from '../../components/ui/States';
import { shortAddress } from '../../services/wallet/WalletService';
import { useGlobalContext, useSystem } from '../../state/system';
import { useModuleConfig, useModuleOutputs } from '../../state/moduleIO';
import { compactNumber, formatAmount, formatRelative } from '../../utils/format';

interface Config extends Record<string, unknown> {
  minValueUsd: number;
}

export function Component({ module }: { module: ModuleInstance }) {
  const system = useSystem();
  const [global] = useGlobalContext();
  const [config, setConfig] = useModuleConfig<Config>(module.id, module.configuration as Config);
  const [movements, setMovements] = useState<WhaleMovement[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const data = await system.market.getWhaleMovements(global.chainId, 20);
      if (cancelled) return;
      setMovements(data);
      const largest = data.find((m) => m.valueUsd >= config.minValueUsd);
      if (largest) system.bus.emit('WHALE_MOVEMENT', { movement: largest }, module.id);
    };
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [system, global.chainId, config.minValueUsd, module.id]);

  const rows = (movements ?? []).filter((m) => m.valueUsd >= config.minValueUsd);
  const top = rows[0] ?? null;

  useModuleOutputs(module.id, {
    movementValue: top?.valueUsd ?? null,
    token: top?.token ?? null,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        className="row"
        style={{ gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-faint)' }}
      >
        <span className="label">MIN VALUE</span>
        <input
          className="input mono-num"
          style={{ maxWidth: 110 }}
          inputMode="numeric"
          value={String(config.minValueUsd)}
          onChange={(event) => setConfig({ minValueUsd: Number(event.target.value.replace(/[^0-9]/g, '')) || 0 })}
        />
        <span className="grow" />
        <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>
          {rows.length} MOVEMENTS
        </span>
      </div>

      {!movements ? (
        <LoadingState label="SCANNING FLOWS" />
      ) : (
        <div className="scroll-y grow">
          <table className="dtable">
            <thead>
              <tr>
                <th>TIME</th>
                <th>DIR</th>
                <th>WALLET</th>
                <th>TOKEN</th>
                <th className="num">AMOUNT</th>
                <th className="num">VALUE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((movement) => (
                <tr key={movement.id}>
                  <td className="faint">{formatRelative(movement.timestamp)}</td>
                  <td className={movement.direction === 'IN' ? 'up' : 'down'}>{movement.direction}</td>
                  <td className="mono-num">{shortAddress(String(movement.wallet))}</td>
                  <td>{movement.token.symbol}</td>
                  <td className="num mono-num">{formatAmount(movement.amount)}</td>
                  <td className="num mono-num">${compactNumber(movement.valueUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
