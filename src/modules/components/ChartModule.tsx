import { useMemo } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import type { PairRef, Timeframe } from '../../core/types';
import { TIMEFRAMES } from '../../core/types';
import { CandleChart } from '../../components/ui/CandleChart';
import { Segmented } from '../../components/ui/Segmented';
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
      <div
        className="row"
        style={{
          gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-3)',
          borderBottom: '1px solid var(--border-faint)',
        }}
      >
        <Segmented
          label="Timeframe"
          value={timeframe}
          disabled={inputs.timeframe !== undefined}
          options={TIMEFRAMES.map((tf) => ({ value: tf, label: tf.toUpperCase() }))}
          onChange={(tf) => setConfig({ timeframe: tf })}
        />
        <span className="grow" />
        <Segmented
          label="Chart style"
          value={config.style}
          options={[
            { value: 'candles', label: 'CANDLES' },
            { value: 'line', label: 'LINE' },
          ]}
          onChange={(style) => setConfig({ style })}
        />
        <Segmented
          label="Volume"
          value={config.showVolume ? 'on' : 'off'}
          options={[
            { value: 'on', label: 'VOL' },
            { value: 'off', label: 'OFF' },
          ]}
          onChange={(value) => setConfig({ showVolume: value === 'on' })}
        />
      </div>
    ),
    [timeframe, config.style, config.showVolume, setConfig, inputs.timeframe],
  );

  if (!pair) {
    return (
      <EmptyState
        title="NO PAIR SELECTED"
        message="Wire a Pair Selector into this chart, or pick a pair from the top bar. Press L to see every port on the deck."
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
