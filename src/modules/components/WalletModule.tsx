import { useState } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import { EmptyState, Stat } from '../../components/ui/States';
import { NETWORKS } from '../../services/market/tokens';
import { shortAddress } from '../../services/wallet/WalletService';
import { useActiveWallet, useGlobalContext, useSystem, useWalletState } from '../../state/system';
import { usePortfolio } from '../../state/marketHooks';
import { useModuleOutputs } from '../../state/moduleIO';
import { formatPct, formatUsd } from '../../utils/format';
import { Button, IconButton } from '../../components/ui/Button';

export function Component({ module }: { module: ModuleInstance }) {
  const system = useSystem();
  const walletState = useWalletState();
  const wallet = useActiveWallet();
  const [global] = useGlobalContext();
  const [watchInput, setWatchInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: portfolio } = usePortfolio(wallet, global.chainId);
  const network = NETWORKS[wallet?.chainId ?? global.chainId] ?? null;

  useModuleOutputs(module.id, {
    wallet,
    address: wallet?.address ?? null,
    network: wallet?.chainId ?? global.chainId,
  });

  const connect = async () => {
    setError(null);
    try {
      await system.wallets.connectInjected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
  };

  const addWatch = () => {
    setError(null);
    try {
      system.wallets.addWatchWallet(watchInput);
      setWatchInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid address');
    }
  };

  if (!wallet) {
    return (
      <EmptyState
        title="NO WALLET CONNECTED"
        message="Connect an execution wallet to trade, or load the demo vault to explore the terminal."
        action={
          <div className="row wrap" style={{ justifyContent: 'center' }}>
            <Button variant="primary" onClick={connect}>
              CONNECT WALLET
            </Button>
            <Button onClick={() => system.wallets.addDemoWallet()}>
              DEMO VAULT
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <>
      <div className="spread">
        <span className="row" style={{ gap: 'var(--space-2)' }}>
          <span className="dot" data-tone={wallet.watchOnly ? 'warning' : 'success'} data-pulse="true" />
          <span className="label">{system.wallets.labelFor(wallet.kind)}</span>
        </span>
        <span className="chip">{network?.shortName ?? `CHAIN ${wallet.chainId}`}</span>
      </div>

      <div className="col" style={{ gap: 2 }}>
        <span className="label">{wallet.label}</span>
        <Button variant="ghost" style={{ justifyContent: 'flex-start', padding: 0, minHeight: 18 }} onClick={() => void navigator.clipboard?.writeText(String(wallet.address))} title="Copy address">
          <span className="mono-num">{shortAddress(String(wallet.address), 6)}</span>
          <span className="faint">⧉</span>
        </Button>
      </div>

      <div className="row wrap" style={{ gap: 'var(--space-6)' }}>
        <Stat label="VALUE" value={formatUsd(portfolio?.totalValueUsd ?? null, { compact: true })} size="md" />
        <Stat
          label="24H"
          value={formatPct(portfolio?.change24hPct ?? null)}
          tone={(portfolio?.change24hPct ?? 0) >= 0 ? 'up' : 'down'}
          size="sm"
        />
        <Stat label="ASSETS" value={portfolio?.holdings.length ?? '—'} size="sm" />
      </div>

      {wallet.watchOnly ? (
        <div className="alert-banner">
          <span aria-hidden>!</span>
          <span>Watch wallet — analysis only. It can never sign a transaction.</span>
        </div>
      ) : null}

      <div className="divider" />

      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <input
          className="input"
          placeholder="0x… ADD WATCH WALLET"
          value={watchInput}
          onChange={(event) => setWatchInput(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && addWatch()}
        />
        <Button onClick={addWatch} disabled={!watchInput}>
          ADD
        </Button>
      </div>

      {walletState.wallets.length > 1 ? (
        <div className="col" style={{ gap: 2 }}>
          <span className="label">VAULTS</span>
          {walletState.wallets.map((item) => (
            <div key={item.id} className="row" style={{ gap: 'var(--space-2)' }}>
              <Button variant="ghost" active={item.id === wallet.id} style={{ justifyContent: 'flex-start', flex: 1 }} onClick={() => system.wallets.setActive(item.id)}>
                <span className="truncate">{item.label}</span>
              </Button>
              <span className="chip" data-tone={item.watchOnly ? 'warning' : 'accent'}>
                {system.wallets.labelFor(item.kind)}
              </span>
              <IconButton label={`Remove ${item.label}`} onClick={() => system.wallets.disconnect(item.id)}>
                ×
              </IconButton>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <div className="alert-banner" data-tone="error">{error}</div> : null}
    </>
  );
}
