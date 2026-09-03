import { useEffect, useMemo, useState } from 'react';
import type { TokenMarket } from '../core/types';
import { TokenAvatar } from '../components/ui/TokenPicker';
import { LoadingState } from '../components/ui/States';
import { NETWORKS, tokensForChain, makePair, findToken } from '../services/market/tokens';
import { useGlobalContext, useSystem } from '../state/system';
import { compactNumber, formatPct, formatPrice } from '../utils/format';
import { Button } from '../components/ui/Button';

export function MarketsPage({ onOpenDesk }: { onOpenDesk: () => void }) {
  const system = useSystem();
  const [global, globalStore] = useGlobalContext();
  const [markets, setMarkets] = useState<TokenMarket[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const data = await system.market.getMarkets(tokensForChain(global.chainId));
      if (!cancelled) setMarkets(data);
    };
    void load();
    const timer = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [system, global.chainId]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (markets ?? []).filter(
      (market) => !q || market.token.symbol.toLowerCase().includes(q) || market.token.name.toLowerCase().includes(q),
    );
  }, [markets, query]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>MARKETS</h1>
          <p className="faint">{NETWORKS[global.chainId]?.name} · {system.market.label}</p>
        </div>
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder="SEARCH TOKENS"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {!markets ? (
        <LoadingState label="LOADING MARKETS" />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="dtable">
            <thead>
              <tr>
                <th>TOKEN</th>
                <th className="num">PRICE</th>
                <th className="num">24H</th>
                <th className="num">7D</th>
                <th className="num">VOLUME</th>
                <th className="num">LIQUIDITY</th>
                <th className="num">MCAP</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((market) => (
                <tr key={market.token.address}>
                  <td>
                    <span className="row" style={{ gap: 'var(--space-2)' }}>
                      <TokenAvatar token={market.token} size={14} />
                      <span>{market.token.symbol}</span>
                      <span className="faint truncate" style={{ maxWidth: 140 }}>{market.token.name}</span>
                    </span>
                  </td>
                  <td className="num mono-num">{formatPrice(market.priceUsd)}</td>
                  <td className={`num mono-num ${market.change24hPct >= 0 ? 'up' : 'down'}`}>
                    {formatPct(market.change24hPct)}
                  </td>
                  <td className={`num mono-num ${market.change7dPct >= 0 ? 'up' : 'down'}`}>
                    {formatPct(market.change7dPct)}
                  </td>
                  <td className="num mono-num">${compactNumber(market.volume24hUsd)}</td>
                  <td className="num mono-num">${compactNumber(market.liquidityUsd)}</td>
                  <td className="num mono-num">${compactNumber(market.marketCapUsd)}</td>
                  <td className="num">
                    <Button variant="ghost" onClick={() => {
                        const quote =
                          findToken(global.chainId, market.token.symbol === 'PLS' ? 'HEX' : 'PLS') ?? market.token;
                        const pair = makePair(market.token, quote);
                        globalStore.set({ token: market.token, pair });
                        system.bus.emit('PAIR_CHANGED', { pair }, 'markets-page');
                        onOpenDesk();
                      }}>
                      TRADE
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
