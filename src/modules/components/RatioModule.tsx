import { useEffect, useMemo, useRef } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import type { PairRef } from '../../core/types';
import { EmptyState, Stat } from '../../components/ui/States';
import { Sparkline } from '../../components/ui/Sparkline';
import { useGlobalContext } from '../../state/system';
import { useTokenMarket } from '../../state/marketHooks';
import { useModuleConfig, useModuleInputs, useModuleOutputs } from '../../state/moduleIO';
import { formatPct, formatRatio } from '../../utils/format';

interface Config extends Record<string, unknown> {
  window: number;
}

export function Component({ module }: { module: ModuleInstance }) {
  const inputs = useModuleInputs(module.id);
  const [global] = useGlobalContext();
  const [config] = useModuleConfig<Config>(module.id, module.configuration as Config);

  const pair = (inputs.pair as PairRef | undefined) ?? global.pair ?? null;
  const baseMarket = useTokenMarket(pair?.base ?? null);
  const quoteMarket = useTokenMarket(pair?.quote ?? null);

  const ratio =
    baseMarket && quoteMarket && quoteMarket.priceUsd > 0 ? baseMarket.priceUsd / quoteMarket.priceUsd : null;

  // Rolling window of observed ratios; resets when the pair changes.
  const history = useRef<number[]>([]);
  const pairId = pair?.id ?? '';
  const lastPair = useRef(pairId);
  if (lastPair.current !== pairId) {
    lastPair.current = pairId;
    history.current = [];
  }
  useEffect(() => {
    if (ratio === null) return;
    history.current = [...history.current, ratio].slice(-config.window);
  }, [ratio, config.window]);

  const stats = useMemo(() => {
    const values = history.current;
    if (!values.length) return null;
    const avg = values.reduce((acc, v) => acc + v, 0) / values.length;
    return {
      avg,
      high: Math.max(...values),
      low: Math.min(...values),
      deviation: ratio !== null && avg ? ((ratio - avg) / avg) * 100 : 0,
      values,
    };
  }, [ratio]);

  useModuleOutputs(module.id, { ratio, deviation: stats?.deviation ?? null });

  if (!pair) return <EmptyState title="NO PAIR" message="Link a pair to compute its ratio." />;

  return (
    <>
      <div className="spread">
        <span className="label">{pair.label}</span>
        <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>
          {history.current.length}/{config.window} SAMPLES
        </span>
      </div>
      <Stat
        label="CURRENT RATIO"
        value={formatRatio(ratio)}
        size="lg"
        sub={`1 ${pair.base.symbol} in ${pair.quote.symbol}`}
      />
      {stats ? (
        <>
          <Sparkline values={stats.values} width={220} height={30} tone={stats.deviation >= 0 ? 'up' : 'down'} />
          <div className="row wrap" style={{ gap: 'var(--space-6)' }}>
            <Stat label="AVERAGE" value={formatRatio(stats.avg)} size="sm" />
            <Stat label="HIGH" value={formatRatio(stats.high)} size="sm" />
            <Stat label="LOW" value={formatRatio(stats.low)} size="sm" />
            <Stat
              label="DEVIATION"
              value={formatPct(stats.deviation)}
              tone={stats.deviation >= 0 ? 'up' : 'down'}
              size="sm"
            />
          </div>
        </>
      ) : (
        <span className="faint">COLLECTING SAMPLES…</span>
      )}
    </>
  );
}
