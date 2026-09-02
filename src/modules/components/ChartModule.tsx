import { useMemo } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import type { PairRef, Timeframe } from '../../core/types';
import { TIMEFRAMES } from '../../core/types';
import { CandleChart } from '../../components/ui/CandleChart';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useGlobalContext } from '../../state/system';
import { useOHLC } from '../../state/marketHooks';
import { useModuleConfig, useModuleInputs, useModuleOutputs } from '../../state/moduleIO';

interface Config extends Record<string, unknown> {
  timeframe: Timeframe;
  style: 'candles' | 'line';
  showVolume: boolean;
}

export function Component({ module }: { module: ModuleInstance }) {
  const inputs = useModuleInputs(module.id);
  const [global] = useGlobalContext();
  const [config, setConfig] = useModuleConfig<Config>(module.id, module.configuration as Config);

  const pair = (inputs.pair as PairRef | undefined) ?? global.pair ?? null;
  const timeframe = (inputs.timeframe as Timeframe | undefined) ?? config.timeframe;
  const { data, loading, error } = useOHLC(pair, timeframe);

  const last = data?.[data.length - 1] ?? null;
  const first = data?.[0] ?? null;
  const changePct = first && last ? ((last.c - first.o) / first.o) * 100 : null;

  useModuleOutputs(module.id, {
    price: last?.c ?? null,
    change: changePct,
    series: data ?? null,
  });

  const controls = useMemo(
    () => (
      <div className="row" style={{ gap: 2, padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-faint)' }}>
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            type="button"
            className="btn"
            data-variant="ghost"
            data-active={timeframe === tf}
            disabled={inputs.timeframe !== undefined}
            onClick={() => setConfig({ timeframe: tf })}
            style={{ minHeight: 18, padding: '0 var(--space-3)' }}
          >
            {tf}
          </button>
        ))}
        <span className="grow" />
        <button
          type="button"
          className="btn"
          data-variant="ghost"
          onClick={() => setConfig({ style: config.style === 'candles' ? 'line' : 'candles' })}
          style={{ minHeight: 18 }}
        >
          {config.style === 'candles' ? 'CANDLES' : 'LINE'}
        </button>
      </div>
    ),
    [timeframe, config.style, setConfig, inputs.timeframe],
  );

  if (!pair) {
    return (
      <EmptyState
        title="NO PAIR SELECTED"
        message="Connect a Pair Selector to this chart, or pick a pair in the workspace."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {controls}
      <div style={{ flex: 1, minHeight: 0, padding: 'var(--space-2)' }}>
        {loading && !data ? (
          <LoadingState label={`LOADING ${pair.label}`} />
        ) : error ? (
          <ErrorState title="SERIES UNAVAILABLE" message={error} />
        ) : (
          <CandleChart
            candles={data ?? []}
            label={`${pair.label} · ${timeframe}`}
            showVolume={config.showVolume}
            style={config.style}
          />
        )}
      </div>
    </div>
  );
}
