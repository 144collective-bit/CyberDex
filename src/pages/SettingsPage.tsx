import { STORAGE_KEYS } from '../core/storage/PersistenceAdapter';
import { useActiveDeck, useDeckActions } from '../state/deck';
import { useGlobalContext, useSystem } from '../state/system';

const THEMES = [
  { id: 'cyber-dark', label: 'CYBER DARK' },
  { id: 'cyber-green', label: 'CYBER GREEN' },
  { id: 'cyber-amber', label: 'CYBER AMBER' },
  { id: 'ice', label: 'ICE' },
];

export function SettingsPage() {
  const system = useSystem();
  const [global, globalStore] = useGlobalContext();
  const deck = useActiveDeck();
  const actions = useDeckActions();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>SETTINGS</h1>
          <p className="faint">Preferences persist through the storage adapter — swap it for an account backend later.</p>
        </div>
      </div>

      <section className="card">
        <h2>APPEARANCE</h2>
        <div className="col" style={{ gap: 'var(--space-3)' }}>
          <span className="label">THEME</span>
          <div className="row wrap" style={{ gap: 'var(--space-2)' }}>
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                className="btn"
                data-active={global.theme === theme.id}
                onClick={() => globalStore.set({ theme: theme.id })}
              >
                {theme.label}
              </button>
            ))}
          </div>
          <span className="label">DATA DENSITY</span>
          <div className="row wrap" style={{ gap: 'var(--space-2)' }}>
            {(['compact', 'normal', 'comfortable'] as const).map((density) => (
              <button
                key={density}
                type="button"
                className="btn"
                data-active={global.density === density}
                onClick={() => globalStore.set({ density })}
              >
                {density.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>ACTIVE DECK · {deck.name}</h2>
        <div className="row wrap" style={{ gap: 'var(--space-2)' }}>
          <button
            type="button"
            className="btn"
            data-active={deck.settings.snapToGrid}
            onClick={() => actions.updateSettings({ snapToGrid: !deck.settings.snapToGrid })}
          >
            GRID SNAP {deck.settings.snapToGrid ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className="btn"
            data-active={deck.settings.showLinks}
            onClick={() => actions.updateSettings({ showLinks: !deck.settings.showLinks })}
          >
            DATA LINES {deck.settings.showLinks ? 'ON' : 'OFF'}
          </button>
          <label className="row" style={{ gap: 'var(--space-2)' }}>
            <span className="label">GRID SIZE</span>
            <input
              className="input mono-num"
              style={{ width: 80 }}
              type="number"
              min={5}
              max={80}
              value={deck.settings.gridSize}
              onChange={(event) => actions.updateSettings({ gridSize: Number(event.target.value) || 20 })}
            />
          </label>
          <button type="button" className="btn" onClick={() => void actions.save()}>
            SAVE DECK NOW
          </button>
        </div>
      </section>

      <section className="card">
        <h2>DATA</h2>
        <div className="col" style={{ gap: 'var(--space-3)', fontSize: 'var(--text-3xs)' }}>
          <div className="spread">
            <span className="faint">STORAGE ADAPTER</span>
            <span className="mono-num">{system.storage.id}</span>
          </div>
          <div className="spread">
            <span className="faint">MARKET PROVIDER</span>
            <span className="mono-num">
              {system.market.label} · {system.market.origin.toUpperCase()}
            </span>
          </div>
          <div className="spread">
            <span className="faint">DEX ADAPTERS</span>
            <span className="mono-num">{system.routing.list().map((a) => a.label).join(' · ')}</span>
          </div>
          <div className="spread">
            <span className="faint">MODE</span>
            <span className="mono-num">{global.demoMode ? 'DEMO — SIMULATED EXECUTION' : 'LIVE WALLET CONNECTED'}</span>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 'var(--space-2)' }}>
          <button
            type="button"
            className="btn"
            data-variant="danger"
            onClick={() => {
              void Promise.all(Object.values(STORAGE_KEYS).map((key) => system.storage.remove(key))).then(() =>
                window.location.reload(),
              );
            }}
          >
            RESET LOCAL DATA
          </button>
        </div>
      </section>

      <section className="card">
        <h2>SECURITY</h2>
        <ul className="col" style={{ gap: 'var(--space-2)', fontSize: 'var(--text-3xs)', paddingLeft: '1.1em', margin: 0 }}>
          <li>CYBER DEX never asks for a seed phrase or private key, and stores neither.</li>
          <li>Signing happens in your wallet provider. Watch wallets cannot sign at all.</li>
          <li>Every trade shows route, contract, amounts and fees before you confirm.</li>
          <li>Simulated transactions are labelled everywhere they appear.</li>
        </ul>
      </section>
    </div>
  );
}
