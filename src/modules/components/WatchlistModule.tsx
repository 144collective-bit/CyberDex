import { useMemo, useState } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import type { TokenRef } from '../../core/types';
import { TokenAvatar, TokenPicker } from '../../components/ui/TokenPicker';
import { findToken } from '../../services/market/tokens';
import { useGlobalContext, useSystem } from '../../state/system';
import { useTokenMarket } from '../../state/marketHooks';
import { useModuleConfig, useModuleOutputs } from '../../state/moduleIO';
import { formatPct, formatPrice } from '../../utils/format';
import { IconButton } from '../../components/ui/Button';

interface Config extends Record<string, unknown> {
  symbols: string[];
}

function WatchRow({
  token,
  selected,
  onSelect,
  onRemove,
}: {
  token: TokenRef;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const market = useTokenMarket(token);
  return (
    <tr data-selected={selected} onClick={onSelect} style={{ cursor: 'pointer' }}>
      <td>
        <span className="row" style={{ gap: 'var(--space-2)' }}>
          <TokenAvatar token={token} size={13} />
          {token.symbol}
        </span>
      </td>
      <td className="num mono-num">{formatPrice(market?.priceUsd)}</td>
      <td className={`num mono-num ${(market?.change24hPct ?? 0) >= 0 ? 'up' : 'down'}`}>
        {formatPct(market?.change24hPct ?? null)}
      </td>
      <td className="num">
        <IconButton label={`Remove ${token.symbol}`} onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}>
          ×
        </IconButton>
      </td>
    </tr>
  );
}

export function Component({ module }: { module: ModuleInstance }) {
  const system = useSystem();
  const [global] = useGlobalContext();
  const [config, setConfig] = useModuleConfig<Config>(module.id, module.configuration as Config);
  const [selected, setSelected] = useState<string | null>(null);

  const tokens = useMemo(
    () => config.symbols.map((symbol) => findToken(global.chainId, symbol)).filter((t): t is TokenRef => Boolean(t)),
    [config.symbols, global.chainId],
  );
  const selectedToken = tokens.find((t) => t.symbol === selected) ?? null;

  useModuleOutputs(module.id, { token: selectedToken });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-faint)' }}>
        <TokenPicker
          chainId={global.chainId}
          value={null}
          onChange={(token) =>
            setConfig({ symbols: Array.from(new Set([...config.symbols, token.symbol])) })
          }
        />
      </div>
      <div className="scroll-y grow">
        <table className="dtable">
          <thead>
            <tr>
              <th>TOKEN</th>
              <th className="num">PRICE</th>
              <th className="num">24H</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <WatchRow
                key={token.address}
                token={token}
                selected={selected === token.symbol}
                onSelect={() => {
                  setSelected(token.symbol);
                  system.bus.emit('TOKEN_SELECTED', { token, source: module.id }, module.id);
                }}
                onRemove={() => setConfig({ symbols: config.symbols.filter((s) => s !== token.symbol) })}
              />
            ))}
            {tokens.length === 0 ? (
              <tr>
                <td colSpan={4} className="faint" style={{ padding: 'var(--space-5)' }}>
                  WATCHLIST EMPTY — add a token above
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
