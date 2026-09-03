import type { ModuleInstance } from '../../core/modules/types';
import type { WalletRecord } from '../../core/types';
import { EmptyState, LoadingState } from '../../components/ui/States';
import { useActiveWallet, useGlobalContext, useSystem } from '../../state/system';
import { usePortfolio } from '../../state/marketHooks';
import { useModuleInputs, useModuleOutputs } from '../../state/moduleIO';
import { formatUsd } from '../../utils/format';
import { Button } from '../../components/ui/Button';

export function Component({ module }: { module: ModuleInstance }) {
  const system = useSystem();
  const inputs = useModuleInputs(module.id);
  const activeWallet = useActiveWallet();
  const [global] = useGlobalContext();
  const wallet = (inputs.wallet as WalletRecord | undefined) ?? activeWallet;
  const { data, loading } = usePortfolio(wallet, wallet?.chainId ?? global.chainId);

  useModuleOutputs(module.id, { token: data?.holdings[0]?.token ?? null });

  if (!wallet) {
    return (
      <EmptyState
        title="NO WALLET"
        message="Connect or link a wallet to see how it is allocated."
        action={
          <Button variant="primary" onClick={() => system.wallets.addDemoWallet()}>
            USE A DEMO WALLET
          </Button>
        }
      />
    );
  }
  if (loading && !data) return <LoadingState label="COMPUTING ALLOCATION" />;

  const total = data?.totalValueUsd ?? 0;
  const rows = (data?.holdings ?? []).slice(0, 8);

  return (
    <div className="col" style={{ gap: 'var(--space-4)' }}>
      {rows.map((holding) => {
        const pct = total ? (holding.valueUsd / total) * 100 : 0;
        return (
          <button
            key={holding.token.address}
            type="button"
            className="col"
            style={{ gap: 2, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
            onClick={() =>
              system.bus.emit('TOKEN_SELECTED', { token: holding.token, source: module.id }, module.id)
            }
          >
            <div className="spread">
              <span>{holding.token.symbol}</span>
              <span className="mono-num faint">
                {formatUsd(holding.valueUsd, { compact: true })} · {pct.toFixed(1)}%
              </span>
            </div>
            <div style={{ height: 5, background: 'var(--surface-sunken)', border: '1px solid var(--border-faint)' }}>
              <div
                style={{
                  width: `${Math.max(1, pct)}%`,
                  height: '100%',
                  background: holding.token.color ?? 'var(--accent)',
                  opacity: 0.75,
                }}
              />
            </div>
          </button>
        );
      })}
      {rows.length === 0 ? <span className="faint">NO ASSETS TO ALLOCATE</span> : null}
    </div>
  );
}
