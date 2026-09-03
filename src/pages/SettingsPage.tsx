import { STORAGE_KEYS } from '../core/storage/PersistenceAdapter';
import { useActiveDeck, useDeckActions } from '../state/deck';
import { useGlobalContext, useSystem } from '../state/system';
import { Button } from '../components/ui/Button';
import { Segmented } from '../components/ui/Segmented';

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
          <Segmented
            label="Theme"
            size="md"
            value={global.theme}
            options={THEMES.map((theme) => ({ value: theme.id, label: theme.label }))}
            onChange={(theme) => globalStore.set({ theme })}
          />
          <span className="label">DATA DENSITY</span>
          <Segmented
            label="Data density"
            size="md"
            value={global.density}
            options={[
              { value: 'compact', label: 'COMPACT', hint: 'Default — most rows per screen' },
              { value: 'normal', label: 'NORMAL' },
              { value: 'comfortable', label: 'COMFORTABLE' },
            ]}
            onChange={(density) => globalStore.set({ density })}
          />
        </div>
      </section>

      <section className="card">
        <h2>ACTIVE DECK · {deck.name}</h2>
        <div className="row wrap" style={{ gap: 'var(--space-5)' }}>
          <Segmented
            label="Grid snap"
            size="md"
            value={deck.settings.snapToGrid ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'GRID SNAP' },
              { value: 'off', label: 'FREE' },
            ]}
            onChange={(value) => actions.updateSettings({ snapToGrid: value === 'on' })}
          />
          <Segmented
            label="Data lines"
            size="md"
            value={deck.settings.showLinks ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'DATA LINES' },
              { value: 'off', label: 'HIDDEN' },
            ]}
            onChange={(value) => actions.updateSettings({ showLinks: value === 'on' })}
          />
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
          <Button onClick={() => void actions.save()}>SAVE DECK NOW</Button>
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
          <Button
            variant="danger"
            onClick={() => {
              void Promise.all(Object.values(STORAGE_KEYS).map((key) => system.storage.remove(key))).then(() =>
                window.location.reload(),
              );
            }}
          >
            RESET LOCAL DATA
          </Button>
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
