import { useEffect, useState } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import type { PairRef, Quote } from '../../core/types';
import { EmptyState, LoadingState } from '../../components/ui/States';
import type { RoutingResult } from '../../services/dex/RoutingEngine';
import { useGlobalContext, useSystem } from '../../state/system';
import { useModuleConfig, useModuleInputs, useModuleOutputs } from '../../state/moduleIO';
import { formatAmount, formatImpact } from '../../utils/format';

interface Config extends Record<string, unknown> {
  amount: string;
}

export function Component({ module }: { module: ModuleInstance }) {
  const system = useSystem();
  const inputs = useModuleInputs(module.id);
  const [global] = useGlobalContext();
  const [config, setConfig] = useModuleConfig<Config>(module.id, module.configuration as Config);
  const [result, setResult] = useState<RoutingResult | null>(null);
  const [loading, setLoading] = useState(false);

  const pair = (inputs.pair as PairRef | undefined) ?? global.pair ?? null;
  const linkedAmount = inputs.amount as number | undefined;
  const amount = linkedAmount ?? (Number(config.amount) || 0);

  useEffect(() => {
    if (!pair || !(amount > 0)) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      const routing = await system.routing.quoteAll({
        source: pair.base,
        dest: pair.quote,
        amountIn: amount,
        slippagePct: 0.5,
        chainId: pair.base.chainId,
      });
      if (!cancelled) {
        setResult(routing);
        setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [system, pair, amount]);

  useModuleOutputs(module.id, { quote: result?.best ?? null });

  if (!pair) return <EmptyState title="NO PAIR" message="Link a pair to compare routes across venues." />;

  return (
    <>
      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <span className="label">SIZE</span>
        <input
          className="input mono-num grow"
          inputMode="decimal"
          value={linkedAmount !== undefined ? String(linkedAmount) : config.amount}
          disabled={linkedAmount !== undefined}
          onChange={(event) => setConfig({ amount: event.target.value.replace(/[^0-9.]/g, '') })}
        />
        <span className="chip">{pair.base.symbol}</span>
      </div>

      {loading && !result ? <LoadingState label="POLLING VENUES" /> : null}

      <div className="col scroll-y grow" style={{ gap: 'var(--space-3)' }}>
        {result?.quotes.map((quote: Quote, index) => (
          <div
            key={quote.id}
            className="col"
            style={{
              gap: 2,
              padding: 'var(--space-3)',
              border: `1px solid ${index === 0 ? 'var(--accent-dim)' : 'var(--border-faint)'}`,
              background: index === 0 ? 'var(--accent-wash)' : 'transparent',
            }}
          >
            <div className="spread">
              <span className="label">{quote.adapterLabel}</span>
              {index === 0 ? <span className="chip" data-tone="accent">BEST ROUTE</span> : null}
            </div>
            <div className="spread mono-num">
              <span>
                {formatAmount(quote.amountIn)} {quote.source.symbol} →
              </span>
              <span>
                {formatAmount(quote.amountOut)} {quote.dest.symbol}
              </span>
            </div>
            <div className="spread faint" style={{ fontSize: 'var(--text-3xs)' }}>
              <span>IMPACT {formatImpact(quote.priceImpactPct)}</span>
              <span className="truncate">{quote.route[0]?.path.join(' → ')}</span>
            </div>
          </div>
        ))}
        {result?.failures.map((failure) => (
          <div key={failure.adapterId} className="spread faint" style={{ fontSize: 'var(--text-3xs)' }}>
            <span>{failure.label}</span>
            <span className="truncate" style={{ maxWidth: '60%' }}>
              {failure.reason}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
