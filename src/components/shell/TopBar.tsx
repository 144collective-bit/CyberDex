import { NETWORKS } from '../../services/market/tokens';
import { shortAddress } from '../../services/wallet/WalletService';
import { useActiveDeck } from '../../state/deck';
import { useActiveWallet, useGlobalContext, useNetworkTelemetry, useNotifications, useSystem } from '../../state/system';
import type { RouteId } from '../../state/router';
import { formatClock } from '../../utils/format';
import { useEffect, useState } from 'react';

export function TopBar({
  onOpenPalette,
  onOpenNotifications,
  navigate,
}: {
  onOpenPalette: () => void;
  onOpenNotifications: () => void;
  navigate: (route: RouteId) => void;
}) {
  const system = useSystem();
  const deck = useActiveDeck();
  const wallet = useActiveWallet();
  const [global] = useGlobalContext();
  const { gas } = useNetworkTelemetry(global.chainId);
  const notifications = useNotifications();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const unread = notifications.filter((n) => !n.read).length;
  const network = NETWORKS[global.chainId];

  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={() => navigate('desk')}>
        <b>CYBER</b> DEX <span>v0.1</span>
      </button>

      <button
        type="button"
        className="btn"
        data-variant="ghost"
        onClick={() => navigate('decks')}
        title="Switch deck"
      >
        {deck.name} <span className="faint">// DECK</span>
      </button>

      <button type="button" className="btn" data-variant="ghost" onClick={onOpenPalette} title="Command palette">
        ⌕ SEARCH <span className="kbd">⌘K</span>
      </button>

      <span className="grow" />

      <div className="topbar-slot">
        <span className="topbar-stat">
          <span className="dot" data-tone={global.demoMode ? 'warning' : 'success'} data-pulse="true" />
          <span>{network?.name.toUpperCase() ?? 'UNKNOWN'}</span>
          {global.demoMode ? <span className="chip" data-tone="warning">DEMO</span> : null}
        </span>

        <span className="topbar-stat">
          <span className="label">GAS</span>
          <span className="mono-num">{gas ? `${gas.baseFeeGwei.toFixed(1)} GWEI` : '—'}</span>
        </span>

        {wallet ? (
          <button
            type="button"
            className="btn"
            data-variant="ghost"
            onClick={() => navigate('wallets')}
            title={wallet.label}
          >
            <span className="dot" data-tone={wallet.watchOnly ? 'warning' : 'success'} />
            <span className="mono-num">{shortAddress(String(wallet.address))}</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            data-variant="primary"
            onClick={() => void system.wallets.connectInjected().catch(() => navigate('wallets'))}
          >
            CONNECT
          </button>
        )}

        <button type="button" className="btn" data-variant="ghost" onClick={onOpenNotifications} aria-label="Notifications">
          ◉ {unread > 0 ? <span className="chip" data-tone="accent">{unread}</span> : null}
        </button>

        <span className="topbar-stat mono-num faint">{formatClock(now)}</span>
      </div>
    </header>
  );
}
