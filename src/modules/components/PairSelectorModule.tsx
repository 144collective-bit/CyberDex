import { useEffect, useMemo } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import type { TokenRef } from '../../core/types';
import { TokenPicker, TokenAvatar } from '../../components/ui/TokenPicker';
import { Stat } from '../../components/ui/States';
import { findToken, makePair, tokensForChain } from '../../services/market/tokens';
import { useGlobalContext, useSystem } from '../../state/system';
import { useTokenMarket } from '../../state/marketHooks';
import { useModuleConfig, useModuleInputs, useModuleOutputs } from '../../state/moduleIO';
import { formatPct, formatPrice, formatRatio, compactNumber } from '../../utils/format';

interface Config extends Record<string, unknown> {
  baseSymbol: string;
  quoteSymbol: string;
  syncGlobal: boolean;
}

/**
 * The deck's most connected module: it owns a pair selection and publishes it,
 * so charts, swaps, ratios and alerts all follow one choice.
 */
export function Component({ module }: { module: ModuleInstance }) {
  const system = useSystem();
  const [global, globalStore] = useGlobalContext();
  const [config, setConfig] = useModuleConfig<Config>(module.id, module.configuration as Config);
  const inputs = useModuleInputs(module.id);

  const chainId = global.chainId;
  const available = useMemo(() => tokensForChain(chainId), [chainId]);

  const linkedToken = inputs.token as TokenRef | undefined;
  const base =
    linkedToken ?? findToken(chainId, config.baseSymbol) ?? available[0] ?? null;
  const quote = findToken(chainId, config.quoteSymbol) ?? available[1] ?? null;

  const baseMarket = useTokenMarket(base);
  const quoteMarket = useTokenMarket(quote);

  const pair = useMemo(() => (base && quote ? makePair(base, quote) : null), [base, quote]);
  const ratio =
    baseMarket && quoteMarket && quoteMarket.priceUsd > 0 ? baseMarket.priceUsd / quoteMarket.priceUsd : null;

  useModuleOutputs(module.id, {
    pair,
    tokenA: base,
    tokenB: quote,
    ratio,
  });

  // Publishing to the bus is what makes an unlinked deck still feel connected.
  useEffect(() => {
    if (!pair) return;
    system.bus.emit('PAIR_CHANGED', { pair }, module.id);
    if (config.syncGlobal) globalStore.set({ pair, token: pair.base });
  }, [system, pair, config.syncGlobal, globalStore, module.id]);

  const setBase = (token: TokenRef) => setConfig({ baseSymbol: token.symbol });
  const setQuote = (token: TokenRef) => setConfig({ quoteSymbol: token.symbol });
  const flip = () => setConfig({ baseSymbol: config.quoteSymbol, quoteSymbol: config.baseSymbol });

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end', gap: 'var(--space-3)' }}>
        <div className="grow">
          <TokenPicker
            chainId={chainId}
            label="TOKEN A"
            value={base}
            exclude={quote}
            onChange={setBase}
            disabled={Boolean(linkedToken)}
          />
        </div>
        <button type="button" className="btn" title="Flip pair" onClick={flip} aria-label="Flip pair">
          ⇄
        </button>
        <div className="grow">
          <TokenPicker chainId={chainId} label="TOKEN B" value={quote} exclude={base} onChange={setQuote} />
        </div>
      </div>

      {pair ? (
        <>
          <div className="row" style={{ gap: 'var(--space-3)' }}>
            {base ? <TokenAvatar token={base} size={18} /> : null}
            <span style={{ fontSize: 'var(--text-lg)', letterSpacing: 'var(--tracking-wide)' }}>{pair.label}</span>
            {baseMarket ? (
              <span className={`chip`} data-tone={baseMarket.change24hPct >= 0 ? 'success' : 'error'}>
                {formatPct(baseMarket.change24hPct)}
              </span>
            ) : null}
          </div>

          <div className="row wrap" style={{ gap: 'var(--space-6)' }}>
            <Stat label="RATIO" value={formatRatio(ratio)} size="sm" sub={`1 ${pair.base.symbol} =`} />
            <Stat label={`${pair.base.symbol} USD`} value={formatPrice(baseMarket?.priceUsd)} size="sm" />
            <Stat
              label="24H VOL"
              value={baseMarket ? `$${compactNumber(baseMarket.volume24hUsd)}` : '—'}
              size="sm"
            />
            <Stat
              label="LIQUIDITY"
              value={baseMarket ? `$${compactNumber(baseMarket.liquidityUsd)}` : '—'}
              size="sm"
            />
          </div>

          <label className="row" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={config.syncGlobal}
              onChange={(event) => setConfig({ syncGlobal: event.target.checked })}
            />
            <span className="label">DRIVE WORKSPACE CONTEXT</span>
          </label>
        </>
      ) : (
        <div className="faint">Select two assets to initialise this module.</div>
      )}
    </>
  );
}
