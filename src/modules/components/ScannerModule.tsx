import { useEffect, useMemo, useState } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import type { TokenMarket } from '../../core/types';
import { LoadingState } from '../../components/ui/States';
import { TokenAvatar } from '../../components/ui/TokenPicker';
import { tokensForChain } from '../../services/market/tokens';
import { useGlobalContext, useSystem } from '../../state/system';
import { useModuleConfig, useModuleOutputs } from '../../state/moduleIO';
import { compactNumber, formatPct, formatPrice } from '../../utils/format';

type SortKey = 'change24hPct' | 'volume24hUsd' | 'liquidityUsd' | 'priceUsd';

interface Config extends Record<string, unknown> {
  sort: SortKey;
  direction: 'asc' | 'desc';
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'priceUsd', label: 'PRICE' },
  { key: 'change24hPct', label: '24H' },
  { key: 'volume24hUsd', label: 'VOLUME' },
  { key: 'liquidityUsd', label: 'LIQUIDITY' },
];

export function Component({ module }: { module: ModuleInstance }) {
  const system = useSystem();
  const [global] = useGlobalContext();
  const [config, setConfig] = useModuleConfig<Config>(module.id, module.configuration as Config);
  const [markets, setMarkets] = useState<TokenMarket[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const data = await system.market.getMarkets(tokensForChain(global.chainId));
      if (!cancelled) setMarkets(data);
    };
    void load();
    const timer = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [system, global.chainId]);

  const rows = useMemo(() => {
    const list = [...(markets ?? [])];
    list.sort((a, b) => {
      const diff = (a[config.sort] as number) - (b[config.sort] as number);
      return config.direction === 'asc' ? diff : -diff;
    });
    return list;
  }, [markets, config.sort, config.direction]);

  useModuleOutputs(module.id, {
    token: rows.find((m) => m.token.symbol === selected)?.token ?? null,
  });

  if (!markets) return <LoadingState label="SCANNING MARKET" />;

  return (
    <div className="scroll-y" style={{ height: '100%' }}>
      <table className="dtable">
        <thead>
          <tr>
            <th>TOKEN</th>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                className="num"
                data-sortable="true"
                onClick={() =>
                  setConfig({
                    sort: column.key,
                    direction: config.sort === column.key && config.direction === 'desc' ? 'asc' : 'desc',
                  })
                }
              >
                {column.label}
                {config.sort === column.key ? (config.direction === 'desc' ? ' ▾' : ' ▴') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((market) => (
            <tr
              key={market.token.address}
              data-selected={selected === market.token.symbol}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setSelected(market.token.symbol);
                system.bus.emit('TOKEN_SELECTED', { token: market.token, source: module.id }, module.id);
              }}
            >
              <td>
                <span className="row" style={{ gap: 'var(--space-2)' }}>
                  <TokenAvatar token={market.token} size={13} />
                  {market.token.symbol}
                </span>
              </td>
              <td className="num mono-num">{formatPrice(market.priceUsd)}</td>
              <td className={`num mono-num ${market.change24hPct >= 0 ? 'up' : 'down'}`}>
                {formatPct(market.change24hPct)}
              </td>
              <td className="num mono-num">${compactNumber(market.volume24hUsd)}</td>
              <td className="num mono-num">${compactNumber(market.liquidityUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
