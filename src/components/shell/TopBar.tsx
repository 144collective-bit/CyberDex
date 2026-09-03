import { useEffect, useState } from 'react';
import { createDeck } from '../../core/deck/deckReducer';
import { serializeDeck } from '../../core/deck/schema';
import { NETWORKS } from '../../services/market/tokens';
import { shortAddress } from '../../services/wallet/WalletService';
import { useActiveDeck, useDeckDispatch, useDeckList } from '../../state/deck';
import {
  useActiveWallet,
  useGlobalContext,
  useNetworkTelemetry,
  useNotifications,
  useSystem,
  useWalletState,
} from '../../state/system';
import type { RouteId } from '../../state/router';
import { formatClock } from '../../utils/format';
import { Button, IconButton } from '../ui/Button';
import { Menu } from '../ui/Menu';
import type { MenuEntry } from '../ui/Menu';

/**
 * Persistent command bar.
 *
 * Every cluster on the right is a menu rather than a label: the deck, the
 * network and the wallet are all switchable from here without leaving the desk.
 */
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
  const decks = useDeckList();
  const dispatch = useDeckDispatch();
  const wallet = useActiveWallet();
  const walletState = useWalletState();
  const [global, globalStore] = useGlobalContext();
  const { gas } = useNetworkTelemetry(global.chainId);
  const notifications = useNotifications();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const unread = notifications.filter((n) => !n.read).length;
  const network = NETWORKS[global.chainId];

  const exportDeckFile = () => {
    const blob = new Blob([serializeDeck(deck)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${deck.name.toLowerCase().replace(/\s+/g, '-')}.cyberdeck.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const deckEntries: MenuEntry[] = [
    { id: 'h1', kind: 'header', label: 'Switch deck' },
    ...decks.map(
      (item): MenuEntry => ({
        id: item.id,
        label: item.name,
        checked: item.id === deck.id,
        onSelect: () => dispatch({ type: 'DECK/ACTIVATE', deckId: item.id }),
      }),
    ),
    { id: 'sep1', kind: 'separator' },
    {
      id: 'new',
      label: 'New deck',
      hint: '⌘D',
      icon: '+',
      onSelect: () => dispatch({ type: 'DECK/ADD', deck: createDeck('NEW DECK') }),
    },
    {
      id: 'duplicate',
      label: 'Duplicate deck',
      icon: '⧉',
      onSelect: () => dispatch({ type: 'DECK/DUPLICATE', deckId: deck.id }),
    },
    { id: 'save', label: 'Save deck', hint: '⌘S', icon: '⤓', onSelect: () => void system.workspace.flush() },
    { id: 'export', label: 'Export deck JSON', icon: '↗', onSelect: exportDeckFile },
    { id: 'sep2', kind: 'separator' },
    { id: 'manage', label: 'Manage decks…', onSelect: () => navigate('decks') },
  ];

  const networkEntries: MenuEntry[] = [
    { id: 'h', kind: 'header', label: 'Network' },
    ...Object.values(NETWORKS).map(
      (net): MenuEntry => ({
        id: String(net.chainId),
        label: net.name,
        hint: String(net.chainId),
        checked: net.chainId === global.chainId,
        onSelect: () => {
          globalStore.set({ chainId: net.chainId });
          void system.wallets.requestChainSwitch(net.chainId);
        },
      }),
    ),
    { id: 'sep', kind: 'separator' },
    { id: 'status', label: 'Network status…', onSelect: () => navigate('settings') },
  ];

  const walletEntries: MenuEntry[] = wallet
    ? [
        { id: 'h', kind: 'header', label: system.wallets.labelFor(wallet.kind) },
        {
          id: 'copy',
          label: 'Copy address',
          icon: '⧉',
          onSelect: () => void navigator.clipboard?.writeText(String(wallet.address)),
        },
        {
          id: 'explorer',
          label: 'View on explorer',
          icon: '↗',
          disabled: !network?.explorerUrl,
          onSelect: () => window.open(`${network?.explorerUrl}/address/${wallet.address}`, '_blank', 'noopener'),
        },
        ...(walletState.wallets.length > 1
          ? ([{ id: 'sep1', kind: 'separator' }, { id: 'h2', kind: 'header', label: 'Switch vault' }] as MenuEntry[])
          : []),
        ...walletState.wallets
          .filter((item) => item.id !== wallet.id)
          .map(
            (item): MenuEntry => ({
              id: item.id,
              label: item.label,
              hint: system.wallets.labelFor(item.kind),
              onSelect: () => system.wallets.setActive(item.id),
            }),
          ),
        { id: 'sep2', kind: 'separator' },
        { id: 'manage', label: 'Manage wallets…', onSelect: () => navigate('wallets') },
        {
          id: 'disconnect',
          label: wallet.kind === 'injected' ? 'Disconnect' : 'Remove vault',
          tone: 'danger',
          onSelect: () => system.wallets.disconnect(wallet.id),
        },
      ]
    : [];

  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={() => navigate('desk')}>
        <b>CYBER</b> DEX <span>v0.1</span>
      </button>

      <Menu
        label="Deck menu"
        entries={deckEntries}
        trigger={(props) => (
          <Button variant="ghost" {...props}>
            {deck.name} <span className="faint">// DECK</span> <span aria-hidden style={{ opacity: 0.5 }}>▾</span>
          </Button>
        )}
      />

      <Button variant="ghost" onClick={onOpenPalette} title="Command palette">
        ⌕ SEARCH <span className="kbd">⌘K</span>
      </Button>

      <span className="grow" />

      <div className="topbar-slot">
        <Menu
          label="Network menu"
          align="end"
          entries={networkEntries}
          trigger={(props) => (
            <Button variant="ghost" {...props}>
              <span className="dot" data-tone={global.demoMode ? 'warning' : 'success'} data-pulse="true" />
              {network?.name.toUpperCase() ?? 'UNKNOWN'}
              {global.demoMode ? (
                <span className="chip" data-tone="warning">
                  DEMO
                </span>
              ) : null}
              <span aria-hidden style={{ opacity: 0.5 }}>▾</span>
            </Button>
          )}
        />

        <span className="topbar-stat" title="Current gas price">
          <span className="label">GAS</span>
          <span className="mono-num">{gas ? `${gas.baseFeeGwei.toFixed(1)} GWEI` : '—'}</span>
        </span>

        {wallet ? (
          <Menu
            label="Wallet menu"
            align="end"
            entries={walletEntries}
            trigger={(props) => (
              <Button variant="ghost" {...props}>
                <span className="dot" data-tone={wallet.watchOnly ? 'warning' : 'success'} />
                <span className="mono-num">{shortAddress(String(wallet.address))}</span>
                <span aria-hidden style={{ opacity: 0.5 }}>▾</span>
              </Button>
            )}
          />
        ) : (
          <Button
            variant="primary"
            loading={walletState.connecting}
            onClick={() => void system.wallets.connectInjected().catch(() => navigate('wallets'))}
          >
            CONNECT
          </Button>
        )}

        <IconButton label={`Notifications${unread ? ` (${unread} unread)` : ''}`} size="md" onClick={onOpenNotifications}>
          <span style={{ position: 'relative' }}>
            ◉
            {unread > 0 ? (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: -3,
                  right: -5,
                  minWidth: 11,
                  height: 11,
                  padding: '0 2px',
                  borderRadius: 6,
                  background: 'var(--accent)',
                  color: 'var(--text-inverse)',
                  fontSize: 8,
                  lineHeight: '11px',
                  textAlign: 'center',
                }}
              >
                {unread > 9 ? '9+' : unread}
              </span>
            ) : null}
          </span>
        </IconButton>

        <span className="topbar-stat mono-num faint">{formatClock(now)}</span>
      </div>
    </header>
  );
}
