import { useState } from 'react';
import { STORAGE_KEYS } from '../../core/storage/PersistenceAdapter';
import { useSystem } from '../../state/system';

/** First launch. Two doors: connect a real wallet, or explore on demo data. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const system = useSystem();
  const [error, setError] = useState<string | null>(null);

  const finish = () => {
    void system.storage.set(STORAGE_KEYS.onboarding, { seenAt: Date.now() });
    onDone();
  };

  return (
    <div className="overlay" style={{ alignItems: 'center' }}>
      <div className="panel" style={{ width: 'min(520px, 100%)' }} role="dialog" aria-label="Welcome">
        <div className="panel-body col" style={{ gap: 'var(--space-6)', textAlign: 'center' }}>
          <div className="col" style={{ gap: 'var(--space-2)' }}>
            <span className="label">WELCOME TO</span>
            <h1 style={{ margin: 0, fontSize: 'var(--text-2xl)', letterSpacing: 'var(--tracking-wide)' }}>
              CYBER <span style={{ color: 'var(--accent)' }}>DEX</span>
            </h1>
            <p className="faint" style={{ margin: 0 }}>Build your own trading terminal.</p>
          </div>

          <div className="col" style={{ gap: 'var(--space-3)', textAlign: 'left', fontSize: 'var(--text-3xs)' }}>
            <span className="faint">Modules are independent. Link an output to an input and the deck becomes a circuit:</span>
            <span className="mono-num">PAIR SELECTOR ──▶ CHART · SWAP · RATIO</span>
            <span className="mono-num">WALLET ──▶ PORTFOLIO ──▶ 25% ──▶ SWAP AMOUNT</span>
          </div>

          {error ? <div className="alert-banner" data-tone="error">{error}</div> : null}

          <div className="col" style={{ gap: 'var(--space-3)' }}>
            <button
              type="button"
              className="btn"
              data-variant="primary"
              data-size="lg"
              onClick={() =>
                void system.wallets
                  .connectInjected()
                  .then(finish)
                  .catch((err: Error) => setError(err.message))
              }
            >
              CONNECT WALLET
            </button>
            <button
              type="button"
              className="btn"
              data-size="lg"
              onClick={() => {
                system.wallets.addDemoWallet();
                finish();
              }}
            >
              EXPLORE DEMO
            </button>
            <button type="button" className="btn" data-variant="ghost" onClick={finish}>
              SKIP — JUST LOOK AROUND
            </button>
          </div>

          <p className="faint" style={{ margin: 0, fontSize: 'var(--text-3xs)' }}>
            Demo mode simulates market data and transactions. Everything simulated is labelled as such — no demo
            trade is ever shown as a settled on-chain transaction.
          </p>
        </div>
      </div>
    </div>
  );
}
