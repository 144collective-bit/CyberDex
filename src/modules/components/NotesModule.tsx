import type { ModuleInstance } from '../../core/modules/types';
import { useModuleConfig, useModuleOutputs } from '../../state/moduleIO';

interface Config extends Record<string, unknown> {
  text: string;
}

export function Component({ module }: { module: ModuleInstance }) {
  const [config, setConfig] = useModuleConfig<Config>(module.id, module.configuration as Config);
  useModuleOutputs(module.id, { text: config.text });

  return (
    <textarea
      className="input grow"
      style={{ resize: 'none', minHeight: 0, lineHeight: 'var(--leading-normal)' }}
      placeholder="Trade plan, levels, reminders — saved with this deck."
      value={config.text}
      onChange={(event) => setConfig({ text: event.target.value })}
      aria-label="Deck notes"
    />
  );
}
