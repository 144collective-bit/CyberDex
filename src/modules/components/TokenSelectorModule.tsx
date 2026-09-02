import type { ModuleInstance } from '../../core/modules/types';
import type { TokenRef } from '../../core/types';
import { Stat } from '../../components/ui/States';
import { TokenPicker } from '../../components/ui/TokenPicker';
import { findToken } from '../../services/market/tokens';
import { useGlobalContext, useSystem } from '../../state/system';
import { useTokenMarket } from '../../state/marketHooks';
import { useModuleConfig, useModuleOutputs } from '../../state/moduleIO';
import { formatPct, formatPrice } from '../../utils/format';

interface Config extends Record<string, unknown> {
  symbol: string;
}

export function Component({ module }: { module: ModuleInstance }) {
  const system = useSystem();
  const [global] = useGlobalContext();
  const [config, setConfig] = useModuleConfig<Config>(module.id, module.configuration as Config);
  const token = findToken(global.chainId, config.symbol) ?? null;
  const market = useTokenMarket(token);

  useModuleOutputs(module.id, { token, price: market?.priceUsd ?? null });

  const select = (next: TokenRef) => {
    setConfig({ symbol: next.symbol });
    system.bus.emit('TOKEN_CHANGED', { token: next }, module.id);
  };

  return (
    <>
      <TokenPicker chainId={global.chainId} value={token} onChange={select} label="TOKEN" />
      <div className="row wrap" style={{ gap: 'var(--space-6)' }}>
        <Stat label="PRICE" value={formatPrice(market?.priceUsd)} size="sm" />
        <Stat
          label="24H"
          value={formatPct(market?.change24hPct ?? null)}
          tone={(market?.change24hPct ?? 0) >= 0 ? 'up' : 'down'}
          size="sm"
        />
      </div>
    </>
  );
}
