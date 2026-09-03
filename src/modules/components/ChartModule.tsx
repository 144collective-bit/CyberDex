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
  /** Empty means no overlay; the periods are the trader's, not ours. */
  movingAverages?: number[];
}

/**
 * Fast and slow, in that order. Two lines is the most a module this size can
 * carry before the candles stop being the subject of the chart.
 */
const MA_PRESETS: { value: string; label: string; periods: number[] }[] = [
  { value: 'off', label: 'OFF', periods: [] },
  { value: 'fast', label: 'MA 7/25', periods: [7, 25] },
  { value: 'slow', label: 'MA 25/99', periods: [25, 99] },
];

const MA_COLORS = ['var(--accent-2)', 'var(--warning)'];

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

  const maPeriods = config.movingAverages ?? [];
  const maPreset =
    MA_PRESETS.find(
      (preset) =>
        preset.periods.length === maPeriods.length &&
        preset.periods.every((period, index) => period === maPeriods[index]),
    )?.value ?? 'off';

  const movingAverages = useMemo(
    () => maPeriods.map((period, index) => ({ period, color: MA_COLORS[index] ?? 'var(--text-muted)' })),
    [maPeriods],
  );

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
          label="Moving averages"
          value={maPreset}
          options={MA_PRESETS.map((preset) => ({ value: preset.value, label: preset.label }))}
          onChange={(value) =>
            setConfig({ movingAverages: MA_PRESETS.find((preset) => preset.value === value)?.periods ?? [] })
          }
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
    [timeframe, config.style, config.showVolume, setConfig, inputs.timeframe, maPreset],
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
            timeframe={timeframe}
            movingAverages={movingAverages}
          />
        )}
      </div>
    </div>
  );
}
