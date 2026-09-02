import type { ModuleInstance } from '../../core/modules/types';
import type { PairRef } from '../../core/types';
import { EmptyState, LoadingState, Stat } from '../../components/ui/States';
import { useGlobalContext } from '../../state/system';
import { useLiquidity } from '../../state/marketHooks';
import { useModuleInputs, useModuleOutputs } from '../../state/moduleIO';
import { compactNumber, formatPct } from '../../utils/format';

export function Component({ module }: { module: ModuleInstance }) {
  const inputs = useModuleInputs(module.id);
  const [global] = useGlobalContext();
  const pair = (inputs.pair as PairRef | undefined) ?? global.pair ?? null;
  const { data, loading, error } = useLiquidity(pair);

  useModuleOutputs(module.id, { liquidity: data?.totalUsd ?? null });

  if (!pair) return <EmptyState title="NO PAIR" message="Link a pair to inspect pool depth." />;
  if (loading && !data) return <LoadingState label="READING POOLS" />;
  if (error || !data) return <EmptyState title="NO LIQUIDITY DATA" message={error ?? 'Indexer returned nothing.'} />;

  return (
    <>
      <div className="spread">
        <Stat label={`${pair.label} TVL`} value={`$${compactNumber(data.totalUsd)}`} size="lg" />
        <span className={`chip`} data-tone={data.change24hPct >= 0 ? 'success' : 'error'}>
          {formatPct(data.change24hPct)} 24H
        </span>
      </div>
      <div className="col" style={{ gap: 'var(--space-3)' }}>
        {data.venues.map((venue) => (
          <div key={venue.dex} className="col" style={{ gap: 2 }}>
            <div className="spread">
              <span>{venue.dex}</span>
              <span className="mono-num faint">
                ${compactNumber(venue.usd)} · {venue.sharePct.toFixed(1)}%
              </span>
            </div>
            <div style={{ height: 4, background: 'var(--surface-sunken)' }}>
              <div style={{ width: `${venue.sharePct}%`, height: '100%', background: 'var(--accent)', opacity: 0.6 }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
