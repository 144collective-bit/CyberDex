import { useCallback, useEffect, useState } from 'react';
import { Desk } from './components/desk/Desk';
import { ModuleLibrary } from './components/desk/ModuleLibrary';
import { CommandPalette } from './components/shell/CommandPalette';
import { NotificationDrawer, ToastStack } from './components/shell/Notifications';
import { Onboarding } from './components/shell/Onboarding';
import { SideRail } from './components/shell/SideRail';
import { StatusBar } from './components/shell/StatusBar';
import { TopBar } from './components/shell/TopBar';
import { STORAGE_KEYS } from './core/storage/PersistenceAdapter';
import { AlertsPage } from './pages/AlertsPage';
import { CircuitsPage } from './pages/CircuitsPage';
import { DecksPage } from './pages/DecksPage';
import { MarketsPage } from './pages/MarketsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { WalletsPage } from './pages/WalletsPage';
import { DeskUIProvider, useDeckActions, useDeckDispatch } from './state/deck';
import { useRoute } from './state/router';
import { useSystem } from './state/system';
import { createDeck } from './core/deck/deckReducer';

function Shell() {
  const system = useSystem();
  const [route, navigate] = useRoute();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  const actions = useDeckActions();
  const dispatch = useDeckDispatch();

  useEffect(() => {
    void system.storage.get<{ seenAt: number }>(STORAGE_KEYS.onboarding).then((seen) => setOnboarding(!seen));
  }, [system]);

  const openLibrary = useCallback(() => {
    navigate('desk');
    setLibraryOpen(true);
  }, [navigate]);

  // Global shortcuts. Everything here is additive — no browser default is
  // hijacked that a trader would miss.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'z') {
        const target = event.target as HTMLElement | null;
        // Let the browser handle undo inside a text field the user is editing.
        if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
        event.preventDefault();
        const done = event.shiftKey ? system.workspace.redo() : system.workspace.undo();
        if (!done) {
          system.notifications.push({
            kind: 'info',
            title: event.shiftKey ? 'NOTHING TO REDO' : 'NOTHING TO UNDO',
            ttlMs: 2000,
          });
        }
      } else if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if (meta && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        openLibrary();
      } else if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void actions.save().then((persisted) => {
          // A degraded adapter raises its own notice; never double-report.
          if (persisted) system.notifications.push({ kind: 'success', title: 'DECK SAVED' });
        });
      } else if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        dispatch({ type: 'DECK/ADD', deck: createDeck('NEW DECK') });
        navigate('desk');
      } else if (event.key === 'Escape') {
        setPaletteOpen(false);
        setLibraryOpen(false);
        setNotificationsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openLibrary, actions, dispatch, navigate, system]);

  return (
    <div className="app">
      <TopBar
        navigate={navigate}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenNotifications={() => setNotificationsOpen((prev) => !prev)}
      />

      <div className="workspace">
        <SideRail route={route} navigate={navigate} onAddModule={openLibrary} />
        <main className="view">
          {route === 'desk' ? <Desk onAddModule={openLibrary} /> : null}
          {route === 'decks' ? <DecksPage onOpenDesk={() => navigate('desk')} /> : null}
          {route === 'markets' ? <MarketsPage onOpenDesk={() => navigate('desk')} /> : null}
          {route === 'wallets' ? <WalletsPage /> : null}
          {route === 'circuits' ? <CircuitsPage onOpenDesk={() => navigate('desk')} /> : null}
          {route === 'alerts' ? <AlertsPage /> : null}
          {route === 'transactions' ? <TransactionsPage /> : null}
          {route === 'settings' ? <SettingsPage /> : null}
        </main>
        {notificationsOpen ? <NotificationDrawer onClose={() => setNotificationsOpen(false)} /> : null}
      </div>

      <StatusBar />

      {libraryOpen ? <ModuleLibrary onClose={() => setLibraryOpen(false)} /> : null}
      {paletteOpen ? (
        <CommandPalette onClose={() => setPaletteOpen(false)} navigate={navigate} onAddModule={openLibrary} />
      ) : null}
      {onboarding ? <Onboarding onDone={() => setOnboarding(false)} /> : null}
      <ToastStack />
    </div>
  );
}

export function App() {
  return (
    <DeskUIProvider>
      <Shell />
    </DeskUIProvider>
  );
}
