import { useMemo } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import { Stat } from '../../components/ui/States';
import { useModuleConfig, useModuleInputs, useModuleOutputs, isLinked } from '../../state/moduleIO';
import { formatAmount } from '../../utils/format';
import { Button } from '../../components/ui/Button';

type Operation = 'percent' | 'multiply' | 'divide' | 'add' | 'subtract' | 'ratio' | 'roi';

interface Config extends Record<string, unknown> {
  operation: Operation;
  operand: number;
  manualValue: number;
}

const OPERATIONS: { id: Operation; label: string; symbol: string }[] = [
  { id: 'percent', label: 'PERCENT', symbol: '%' },
  { id: 'multiply', label: 'MULTIPLY', symbol: '×' },
  { id: 'divide', label: 'DIVIDE', symbol: '÷' },
  { id: 'add', label: 'ADD', symbol: '+' },
  { id: 'subtract', label: 'SUBTRACT', symbol: '−' },
  { id: 'ratio', label: 'RATIO', symbol: ':' },
  { id: 'roi', label: 'ROI', symbol: 'Δ%' },
];

/** Pure maths, exported so the same rules are unit-tested. */
export function calculate(operation: Operation, value: number, operand: number): number {
  switch (operation) {
    case 'percent':
      return (value * operand) / 100;
    case 'multiply':
      return value * operand;
    case 'divide':
      return operand === 0 ? 0 : value / operand;
    case 'add':
      return value + operand;
    case 'subtract':
      return value - operand;
    case 'ratio':
      return operand === 0 ? 0 : value / operand;
    case 'roi':
      return operand === 0 ? 0 : ((value - operand) / operand) * 100;
    default:
      return value;
  }
}

/**
 * The module that proves the architecture: balance in, 25% out, straight into a
 * swap amount — with no code linking the three.
 */
export function Component({ module }: { module: ModuleInstance }) {
  const inputs = useModuleInputs(module.id);
  const [config, setConfig] = useModuleConfig<Config>(module.id, module.configuration as Config);

  const linkedValue = inputs.value as number | undefined;
  const value = linkedValue ?? config.manualValue;
  const operand = (inputs.operand as number | undefined) ?? config.operand;
  const result = useMemo(() => calculate(config.operation, value, operand), [config.operation, value, operand]);

  useModuleOutputs(module.id, { result });

  const active = OPERATIONS.find((op) => op.id === config.operation) ?? OPERATIONS[0]!;

  return (
    <>
      <div className="col" style={{ gap: 2 }}>
        <span className="label">INPUT {isLinked(inputs, 'value') ? '· LINKED' : '· MANUAL'}</span>
        <input
          className="input mono-num"
          inputMode="decimal"
          value={linkedValue !== undefined ? String(linkedValue) : String(config.manualValue)}
          disabled={linkedValue !== undefined}
          onChange={(event) => setConfig({ manualValue: Number(event.target.value.replace(/[^0-9.\-]/g, '')) || 0 })}
        />
      </div>

      <div className="row wrap" style={{ gap: 2 }}>
        {OPERATIONS.map((op) => (
          <Button key={op.id} variant="ghost" active={config.operation === op.id} style={{ minHeight: 18 }} onClick={() => setConfig({ operation: op.id })} title={op.label}>
            {op.symbol}
          </Button>
        ))}
      </div>

      <div className="col" style={{ gap: 2 }}>
        <span className="label">OPERAND {isLinked(inputs, 'operand') ? '· LINKED' : ''}</span>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <input
            className="input mono-num grow"
            inputMode="decimal"
            value={String(operand)}
            disabled={inputs.operand !== undefined}
            onChange={(event) => setConfig({ operand: Number(event.target.value.replace(/[^0-9.\-]/g, '')) || 0 })}
          />
          {config.operation === 'percent'
            ? [10, 25, 50, 100].map((preset) => (
                <Button key={preset} variant="ghost" style={{ minHeight: 18 }} onClick={() => setConfig({ operand: preset })}>
                  {preset}
                </Button>
              ))
            : null}
        </div>
      </div>

      <div className="divider" />
      <Stat label={`RESULT · ${active.label}`} value={formatAmount(result)} size="lg" />
      <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>
        Connect RESULT into a Swap amount, an Alert threshold, or another calculator.
      </span>
    </>
  );
}
