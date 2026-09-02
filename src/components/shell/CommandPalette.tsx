import { useEffect, useMemo, useRef, useState } from 'react';
import { listModuleDefinitions } from '../../core/modules/registry';
import { hasModuleComponent } from '../../modules/components';
import { NETWORKS, tokensForChain, findToken, makePair } from '../../services/market/tokens';
import { useActiveDeck, useDeckActions, useDeckList, useDeckDispatch } from '../../state/deck';
import { useGlobalContext, useSystem, useWalletState } from '../../state/system';
import type { RouteId } from '../../state/router';
import { ROUTE_META } from '../../state/router';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** ⌘K — one entry point to every action in the terminal. */
export function CommandPalette({
  onClose,
  navigate,
  onAddModule,
}: {
  onClose: () => void;
  navigate: (route: RouteId) => void;
  onAddModule: () => void;
}) {
  const system = useSystem();
  const deck = useActiveDeck();
  const decks = useDeckList();
  const actions = useDeckActions();
  const dispatch = useDeckDispatch();
  const walletState = useWalletState();
  const [global, globalStore] = useGlobalContext();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];

    for (const id of Object.keys(ROUTE_META) as RouteId[]) {
      list.push({
        id: `nav:${id}`,
        group: 'NAVIGATE',
        label: `OPEN ${ROUTE_META[id].label}`,
        run: () => navigate(id),
      });
    }

    list.push({
      id: 'module:library',
      group: 'MODULES',
      label: 'OPEN MODULE LIBRARY',
      hint: '⌘M',
      run: onAddModule,
    });
    for (const def of listModuleDefinitions().filter((d) => hasModuleComponent(d.type))) {
      list.push({
        id: `module:${def.type}`,
        group: 'ADD MODULE',
        label: `ADD ${def.name}`,
        hint: def.category,
        run: () => actions.addModule(def.type),
      });
    }

    for (const item of decks) {
      list.push({
        id: `deck:${item.id}`,
        group: 'DECKS',
        label: `OPEN DECK ${item.name}`,
        run: () => dispatch({ type: 'DECK/ACTIVATE', deckId: item.id }),
      });
    }
    list.push({
      id: 'deck:save',
      group: 'DECKS',
      label: 'SAVE DECK',
      hint: '⌘S',
      run: () => void actions.save(),
    });

    for (const wallet of walletState.wallets) {
      list.push({
        id: `wallet:${wallet.id}`,
        group: 'WALLETS',
        label: `SWITCH TO ${wallet.label}`,
        hint: wallet.watchOnly ? 'WATCH' : 'EXECUTION',
        run: () => system.wallets.setActive(wallet.id),
      });
    }
    list.push({
      id: 'wallet:connect',
      group: 'WALLETS',
      label: 'CONNECT BROWSER WALLET',
      run: () => void system.wallets.connectInjected().catch(() => navigate('wallets')),
    });
    list.push({
      id: 'wallet:demo',
      group: 'WALLETS',
      label: 'LOAD DEMO VAULT',
      run: () => system.wallets.addDemoWallet(),
    });

    for (const network of Object.values(NETWORKS)) {
      list.push({
        id: `network:${network.chainId}`,
        group: 'NETWORK',
        label: `SWITCH TO ${network.name.toUpperCase()}`,
        run: () => {
          globalStore.set({ chainId: network.chainId });
          system.wallets.setChain(network.chainId);
        },
      });
    }

    for (const token of tokensForChain(global.chainId)) {
      list.push({
        id: `token:${token.address}`,
        group: 'TOKENS',
        label: `SELECT ${token.symbol}`,
        hint: token.name,
        run: () => {
          globalStore.set({ token });
          system.bus.emit('TOKEN_CHANGED', { token }, 'command-palette');
        },
      });
      const quote = findToken(global.chainId, token.symbol === 'PLS' ? 'HEX' : 'PLS');
      if (quote && quote.address !== token.address) {
        list.push({
          id: `pair:${token.address}`,
          group: 'PAIRS',
          label: `SET PAIR ${token.symbol}/${quote.symbol}`,
          run: () => {
            const pair = makePair(token, quote);
            globalStore.set({ pair, token });
            system.bus.emit('PAIR_CHANGED', { pair }, 'command-palette');
          },
        });
      }
    }

    list.push({
      id: 'deck:links',
      group: 'DECK',
      label: deck.settings.showLinks ? 'HIDE DATA LINES' : 'SHOW DATA LINES',
      run: () => actions.updateSettings({ showLinks: !deck.settings.showLinks }),
    });
    list.push({
      id: 'deck:snap',
      group: 'DECK',
      label: deck.settings.snapToGrid ? 'DISABLE GRID SNAP' : 'ENABLE GRID SNAP',
      run: () => actions.updateSettings({ snapToGrid: !deck.settings.snapToGrid }),
    });

    return list;
  }, [navigate, onAddModule, actions, decks, dispatch, walletState.wallets, system, globalStore, global.chainId, deck.settings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? commands.filter((command) => `${command.group} ${command.label} ${command.hint ?? ''}`.toLowerCase().includes(q))
      : commands.slice(0, 40);
    return matches.slice(0, 60);
  }, [commands, query]);

  useEffect(() => setIndex(0), [query]);

  const runAt = (position: number) => {
    const command = filtered[position];
    if (!command) return;
    command.run();
    onClose();
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="panel" style={{ width: 'min(640px, 100%)' }} role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="TYPE A COMMAND — MODULE, DECK, TOKEN, WALLET…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIndex((prev) => Math.min(prev + 1, filtered.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex((prev) => Math.max(prev - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              runAt(index);
            } else if (event.key === 'Escape') {
              onClose();
            }
          }}
        />
        <div className="palette-list">
          {filtered.map((command, position) => (
            <button
              key={command.id}
              type="button"
              className="palette-item"
              data-active={position === index}
              onMouseEnter={() => setIndex(position)}
              onClick={() => runAt(position)}
            >
              <span className="label" style={{ width: 92 }}>
                {command.group}
              </span>
              <span className="grow truncate">{command.label}</span>
              {command.hint ? <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>{command.hint}</span> : null}
            </button>
          ))}
          {filtered.length === 0 ? (
            <div className="empty">
              <h5>NO COMMANDS</h5>
              <p>Nothing matches “{query}”.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
