import type { ModuleInstance } from '../../core/modules/types';
import type { TokenRef } from '../../core/types';
import { EmptyState, Stat } from '../../components/ui/States';
import { TokenAvatar } from '../../components/ui/TokenPicker';
import { NETWORKS } from '../../services/market/tokens';
import { useGlobalContext } from '../../state/system';
import { useTokenMarket } from '../../state/marketHooks';
import { useModuleInputs, useModuleOutputs } from '../../state/moduleIO';
import { compactNumber, formatPrice } from '../../utils/format';

export function Component({ module }: { module: ModuleInstance }) {
  const inputs = useModuleInputs(module.id);
  const [global] = useGlobalContext();
  const token = (inputs.token as TokenRef | undefined) ?? global.token ?? global.pair?.base ?? null;
  const market = useTokenMarket(token);

  useModuleOutputs(module.id, { token });

  if (!token) return <EmptyState title="NO TOKEN" message="Link a token to inspect its contract and market." />;

  const network = NETWORKS[token.chainId];

  return (
    <>
      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <TokenAvatar token={token} size={22} />
        <div className="col" style={{ gap: 0 }}>
          <span style={{ fontSize: 'var(--text-lg)' }}>{token.symbol}</span>
          <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>
            {token.name}
          </span>
        </div>
        <span className="grow" />
        <span className="chip" data-tone={token.verified ? 'success' : 'warning'}>
          {token.verified ? 'VERIFIED' : 'UNVERIFIED'}
        </span>
      </div>

      <div className="col" style={{ gap: 2, fontSize: 'var(--text-3xs)' }}>
        <div className="spread">
          <span className="faint">CONTRACT</span>
          <button
            type="button"
            className="btn"
            data-variant="ghost"
            style={{ minHeight: 16, maxWidth: '70%' }}
            onClick={() => void navigator.clipboard?.writeText(String(token.address))}
          >
            <span className="truncate mono-num">{token.address}</span>
          </button>
        </div>
        <div className="spread">
          <span className="faint">NETWORK</span>
          <span>{network?.name ?? token.chainId}</span>
        </div>
        <div className="spread">
          <span className="faint">DECIMALS</span>
          <span className="mono-num">{token.decimals}</span>
        </div>
        {token.tags?.length ? (
          <div className="spread">
            <span className="faint">TAGS</span>
            <span>{token.tags.join(' · ').toUpperCase()}</span>
          </div>
        ) : null}
      </div>

      <div className="divider" />
      <div className="row wrap" style={{ gap: 'var(--space-6)' }}>
        <Stat label="PRICE" value={formatPrice(market?.priceUsd)} size="sm" />
        <Stat label="MCAP" value={market ? `$${compactNumber(market.marketCapUsd)}` : '—'} size="sm" />
        <Stat label="VOL 24H" value={market ? `$${compactNumber(market.volume24hUsd)}` : '—'} size="sm" />
        <Stat label="LIQUIDITY" value={market ? `$${compactNumber(market.liquidityUsd)}` : '—'} size="sm" />
      </div>
    </>
  );
}
