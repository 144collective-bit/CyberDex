import type { ModuleInstance } from '../../core/modules/types';
import { LoadingState, SimulatedTag, Stat } from '../../components/ui/States';
import { useGlobalContext, useNetworkTelemetry } from '../../state/system';
import { useModuleOutputs } from '../../state/moduleIO';
import { formatUsd } from '../../utils/format';

export function Component({ module }: { module: ModuleInstance }) {
  const [global] = useGlobalContext();
  const { gas } = useNetworkTelemetry(global.chainId);

  useModuleOutputs(module.id, {
    gasGwei: gas?.baseFeeGwei ?? null,
    block: gas?.blockNumber ?? null,
  });

  if (!gas) return <LoadingState label="READING GAS" />;

  const swapCostUsd = gas.baseFeeGwei * 1e-9 * 180_000 * (global.chainId === 369 ? 0.0000342 : 3420);

  return (
    <>
      <div className="spread">
        <span className="label">NETWORK FEE</span>
        {gas.simulated ? <SimulatedTag label="DEMO" /> : null}
      </div>
      <Stat label="GAS" value={`${gas.baseFeeGwei.toFixed(2)} GWEI`} size="lg" flashOn={gas.baseFeeGwei} />
      <div className="row wrap" style={{ gap: 'var(--space-6)' }}>
        <Stat label="PRIORITY" value={`${gas.priorityFeeGwei.toFixed(2)}`} size="sm" />
        <Stat label="BLOCK" value={gas.blockNumber.toLocaleString()} size="sm" />
        <Stat label="SWAP EST." value={formatUsd(swapCostUsd)} size="sm" />
      </div>
    </>
  );
}
