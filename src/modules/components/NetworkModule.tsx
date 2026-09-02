import type { ModuleInstance } from '../../core/modules/types';
import type { ServiceHealth } from '../../core/types';
import { Stat } from '../../components/ui/States';
import { NETWORKS } from '../../services/market/tokens';
import { useGlobalContext, useNetworkTelemetry, useSystem } from '../../state/system';
import { useModuleOutputs } from '../../state/moduleIO';
import { formatRelative } from '../../utils/format';

const TONE: Record<ServiceHealth, string> = {
  online: 'success',
  degraded: 'warning',
  offline: 'error',
  unknown: '',
};

export function Component({ module }: { module: ModuleInstance }) {
  const system = useSystem();
  const [global, globalStore] = useGlobalContext();
  const { gas, status, network } = useNetworkTelemetry(global.chainId);

  useModuleOutputs(module.id, { network: global.chainId });

  return (
    <>
      <div className="spread">
        <span className="row" style={{ gap: 'var(--space-2)' }}>
          <span className="dot" data-tone={TONE[status.rpc] || undefined} data-pulse="true" />
          <span style={{ letterSpacing: 'var(--tracking-wide)' }}>
            {(network?.name ?? 'UNKNOWN').toUpperCase()}
          </span>
        </span>
        <span className="chip">{global.demoMode ? 'DEMO DATA' : 'LIVE'}</span>
      </div>

      <select
        className="select"
        value={global.chainId}
        onChange={(event) => {
          const chainId = Number(event.target.value);
          globalStore.set({ chainId });
          system.wallets.setChain(chainId);
        }}
        aria-label="Network"
      >
        {Object.values(NETWORKS).map((net) => (
          <option key={net.chainId} value={net.chainId}>
            {net.name} · {net.chainId}
          </option>
        ))}
      </select>

      <div className="col" style={{ gap: 2, fontSize: 'var(--text-3xs)' }}>
        {(
          [
            ['RPC', status.rpc],
            ['INDEXER', status.indexer],
            ['DEX ROUTER', status.router],
          ] as const
        ).map(([label, health]) => (
          <div key={label} className="spread">
            <span className="row" style={{ gap: 'var(--space-2)' }}>
              <span className="dot" data-tone={TONE[health] || undefined} />
              <span className="faint">{label}</span>
            </span>
            <span className="mono-num">{health.toUpperCase()}</span>
          </div>
        ))}
      </div>

      <div className="row wrap" style={{ gap: 'var(--space-6)' }}>
        <Stat label="BLOCK" value={gas?.blockNumber.toLocaleString() ?? '—'} size="sm" />
        <Stat label="CHAIN ID" value={global.chainId} size="sm" />
        <Stat
          label="CHECKED"
          value={status.lastCheck ? `${formatRelative(status.lastCheck)} AGO` : '—'}
          size="sm"
        />
      </div>
    </>
  );
}
