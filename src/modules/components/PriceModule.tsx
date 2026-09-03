import type { ModuleInstance } from '../../core/modules/types';
import type { PairRef, TokenRef } from '../../core/types';
import { EmptyState, Stat, SimulatedTag } from '../../components/ui/States';
import { useGlobalContext } from '../../state/system';
import { useTokenMarket } from '../../state/marketHooks';
import { useModuleInputs, useModuleOutputs } from '../../state/moduleIO';
import { compactNumber, formatPct, formatPrice, formatRelative } from '../../utils/format';

/** A quote older than this is called out rather than shown as current. */
const STALE_AFTER_MS = 90_000;

export function Component({ module }: { module: ModuleInstance }) {
  const inputs = useModuleInputs(module.id);
  const [global] = useGlobalContext();

  // Precedence: linked token → linked pair's base → workspace context.
  const linkedToken = inputs.token as TokenRef | undefined;
  const linkedPair = inputs.pair as PairRef | undefined;
  const token = linkedToken ?? linkedPair?.base ?? global.pair?.base ?? global.token ?? null;

  const market = useTokenMarket(token);

  useModuleOutputs(module.id, {
    price: market?.priceUsd ?? null,
    change: market?.change24hPct ?? null,
    volume: market?.volume24hUsd ?? null,
  });

  if (!token) {
    return (
      <EmptyState
        title="NO TOKEN"
        message="Link a token or pair into this module, or select one in the workspace."
      />
    );
  }

  if (!market) {
    return (
      <div className="col">
        <span className="label">{token.symbol}</span>
        <div className="skeleton" style={{ width: '60%', height: 20 }} />
        <div className="skeleton" style={{ width: '40%' }} />
      </div>
    );
  }

  const tone = market.change24hPct >= 0 ? 'up' : 'down';
  const stale = Date.now() - market.updatedAt > STALE_AFTER_MS;

  return (
    <>
      <div className="spread">
        <span className="label">{token.symbol} / USD</span>
        <span className="row" style={{ gap: 'var(--space-2)' }}>
          {stale ? (
            <span className="chip" data-tone="warning" title="This price has not refreshed recently">
              STALE
            </span>
          ) : null}
          {market.simulated ? <SimulatedTag label="DEMO" /> : null}
        </span>
      </div>
      <Stat label="PRICE" value={formatPrice(market.priceUsd)} tone={tone} size="lg" />
      <div className="row wrap" style={{ gap: 'var(--space-6)' }}>
        <Stat label="24H" value={formatPct(market.change24hPct)} tone={tone} size="sm" />
        <Stat label="7D" value={formatPct(market.change7dPct)} tone={market.change7dPct >= 0 ? 'up' : 'down'} size="sm" />
        <Stat label="VOL 24H" value={`$${compactNumber(market.volume24hUsd)}`} size="sm" />
        <Stat label="LIQ" value={`$${compactNumber(market.liquidityUsd)}`} size="sm" />
      </div>
      <div className={stale ? 'down' : 'faint'} style={{ fontSize: 'var(--text-3xs)' }}>
        UPDATED {formatRelative(market.updatedAt)} AGO
      </div>
    </>
  );
}
