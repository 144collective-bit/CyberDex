import { useState } from 'react';
import { NETWORKS } from '../services/market/tokens';
import { shortAddress } from '../services/wallet/WalletService';
import { useActiveWallet, useGlobalContext, useSystem, useWalletState } from '../state/system';
import { usePortfolio } from '../state/marketHooks';
import { formatPct, formatUsd, formatRelative } from '../utils/format';
import { Button } from '../components/ui/Button';

export function WalletsPage() {
  const system = useSystem();
  const state = useWalletState();
  const active = useActiveWallet();
  const [global] = useGlobalContext();
  const { data: portfolio } = usePortfolio(active, global.chainId);
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addWatch = () => {
    try {
      system.wallets.addWatchWallet(address, label);
      setAddress('');
      setLabel('');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid address');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>WALLETS</h1>
          <p className="faint">
            Execution wallets sign through their own provider. Watch wallets are read-only, always.
          </p>
        </div>
        <div className="row wrap">
          <Button variant="primary" disabled={state.connecting} onClick={() => void system.wallets.connectInjected().catch((err) => setError(err.message))}>
            {state.connecting ? 'CONNECTING…' : 'CONNECT BROWSER WALLET'}
          </Button>
          <Button onClick={() => system.wallets.addDemoWallet()}>
            LOAD DEMO VAULT
          </Button>
        </div>
      </div>

      {!state.injectedAvailable ? (
        <div className="alert-banner" data-tone="info">
          No injected wallet detected in this browser. Mobile and hardware wallet transports plug into the same
          WalletService interface — the demo vault works meanwhile.
        </div>
      ) : null}
      {error ? <div className="alert-banner" data-tone="error">{error}</div> : null}

      <section className="col">
        <h2>ADD WATCH WALLET</h2>
        <div className="row wrap" style={{ gap: 'var(--space-3)' }}>
          <input
            className="input"
            style={{ maxWidth: 420 }}
            placeholder="0x…"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
          <input
            className="input"
            style={{ maxWidth: 200 }}
            placeholder="LABEL (OPTIONAL)"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <Button onClick={addWatch} disabled={!address}>
            ADD
          </Button>
        </div>
      </section>

      <section className="col">
        <h2>VAULTS</h2>
        <div className="cards">
          {state.wallets.map((wallet) => (
            <article key={wallet.id} className="card">
              <div className="spread">
                <span className="row" style={{ gap: 'var(--space-2)' }}>
                  <span className="dot" data-tone={wallet.watchOnly ? 'warning' : 'success'} />
                  <span>{wallet.label}</span>
                </span>
                <span className="chip" data-tone={wallet.watchOnly ? 'warning' : 'accent'}>
                  {system.wallets.labelFor(wallet.kind)}
                </span>
              </div>
              <span className="mono-num faint">{shortAddress(String(wallet.address), 8)}</span>
              <div className="row wrap faint" style={{ fontSize: 'var(--text-3xs)', gap: 'var(--space-4)' }}>
                <span>{NETWORKS[wallet.chainId]?.name ?? `CHAIN ${wallet.chainId}`}</span>
                <span>ADDED {formatRelative(wallet.addedAt)} AGO</span>
              </div>
              <div className="row wrap" style={{ gap: 'var(--space-2)' }}>
                <Button active={wallet.id === active?.id} onClick={() => system.wallets.setActive(wallet.id)}>
                  {wallet.id === active?.id ? 'ACTIVE' : 'ACTIVATE'}
                </Button>
                <Button onClick={() => void navigator.clipboard?.writeText(String(wallet.address))}>
                  COPY
                </Button>
                <Button variant="danger" onClick={() => system.wallets.disconnect(wallet.id)}>
                  {wallet.kind === 'injected' ? 'DISCONNECT' : 'REMOVE'}
                </Button>
              </div>
            </article>
          ))}
          {state.wallets.length === 0 ? (
            <div className="empty">
              <h5>NO WALLETS</h5>
              <p>Connect an execution wallet, add a watch address, or load the demo vault.</p>
            </div>
          ) : null}
        </div>
      </section>

      {active && portfolio ? (
        <section className="col">
          <h2>ACTIVE VAULT · {active.label}</h2>
          <div className="card">
            <div className="row wrap" style={{ gap: 'var(--space-8)' }}>
              <div className="col" style={{ gap: 0 }}>
                <span className="label">TOTAL VALUE</span>
                <span className="stat-value">{formatUsd(portfolio.totalValueUsd, { compact: true })}</span>
              </div>
              <div className="col" style={{ gap: 0 }}>
                <span className="label">24H</span>
                <span className={`stat-value ${portfolio.change24hPct >= 0 ? 'up' : 'down'}`}>
                  {formatPct(portfolio.change24hPct)}
                </span>
              </div>
              <div className="col" style={{ gap: 0 }}>
                <span className="label">HOLDINGS</span>
                <span className="stat-value">{portfolio.holdings.length}</span>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
