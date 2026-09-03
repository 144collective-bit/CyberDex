import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { EventBus, systemBus } from '../core/events/bus';
import { WorkspaceStore } from '../core/deck/store';
import { moduleRuntime } from '../core/modules/runtime';
import { createDefaultAdapter } from '../core/storage/LocalStorageAdapter';
import type { StorageFailure } from '../core/storage/LocalStorageAdapter';
import type { PersistenceAdapter } from '../core/storage/PersistenceAdapter';
import { STORAGE_KEYS } from '../core/storage/PersistenceAdapter';
import { TelemetryService } from '../services/telemetry/TelemetryService';
import type { ChainProvider } from '../services/chain/ChainProvider';
import { DemoChainProvider } from '../services/chain/DemoChainProvider';
import { EvmChainProvider } from '../services/chain/EvmChainProvider';
import { DemoDexAdapter } from '../services/dex/adapters/DemoDexAdapter';
import { RoutingEngine } from '../services/dex/RoutingEngine';
import { DemoMarketDataProvider } from '../services/market/DemoMarketDataProvider';
import type { MarketDataProvider } from '../services/market/MarketDataProvider';
import { NETWORKS } from '../services/market/tokens';
import { NotificationCenter } from '../services/notifications/NotificationCenter';
import { PortfolioService } from '../services/portfolio/PortfolioService';
import { WalletService } from '../services/wallet/WalletService';
import { TransactionLedger } from '../services/execution/TransactionLedger';
import { ExecutionService } from '../services/execution/ExecutionService';
import { AlertEngine } from '../services/alerts/AlertEngine';
import { GlobalContextStore } from './globalStore';
import { useStoreSelector } from '../core/useStore';
import { buildDefaultWorkspace } from '../modules/templates';

export interface System {
  bus: EventBus;
  storage: PersistenceAdapter;
  market: MarketDataProvider;
  routing: RoutingEngine;
  wallets: WalletService;
  portfolio: PortfolioService;
  ledger: TransactionLedger;
  execution: ExecutionService;
  alerts: AlertEngine;
  notifications: NotificationCenter;
  global: GlobalContextStore;
  workspace: WorkspaceStore;
  telemetry: TelemetryService;
  runtime: typeof moduleRuntime;
  /** Chain access for a given chain — live when an injected wallet is active. */
  chainFor(chainId: number): ChainProvider;
}

export function createSystem(options: { storage?: PersistenceAdapter; bus?: EventBus } = {}): System {
  const bus = options.bus ?? systemBus;
  // Storage problems must reach the user, so failures are routed to the bus the
  // notification centre already listens on.
  const reportStorageFailure = (failure: StorageFailure) =>
    bus.emit(
      'SYSTEM_NOTICE',
      {
        level: 'error',
        message: `SAVE FAILED — ${failure.message} Changes are kept for this session only.`,
      },
      'storage',
    );
  const storage = options.storage ?? createDefaultAdapter(reportStorageFailure);

  const market = new DemoMarketDataProvider();
  const routing = new RoutingEngine();
  // Venues differ in fee and depth so route comparison is meaningful.
  routing.register(
    new DemoDexAdapter(
      {
        id: 'pulsex-v2',
        label: 'PULSEX V2',
        chainIds: [369],
        feePct: 0.0029,
        liquidityShare: 0.55,
        router: '0x165C3410fC91EF562C50559f7d2289fEbed552d9',
      },
      market,
    ),
  );
  routing.register(
    new DemoDexAdapter(
      {
        id: 'pulsex-v1',
        label: 'PULSEX V1',
        chainIds: [369],
        feePct: 0.0022,
        liquidityShare: 0.28,
        router: '0x98bf93ebf5c380C0e6Ae8e192A7e2AE08edAcc02',
        requiresHop: true,
      },
      market,
    ),
  );
  routing.register(
    new DemoDexAdapter(
      {
        id: '9mm',
        label: '9MM',
        chainIds: [369],
        feePct: 0.0017,
        liquidityShare: 0.14,
        router: '0xcC73b59F8D7b7c532703bDfea2808a28a488cF47',
      },
      market,
    ),
  );
  routing.register(
    new DemoDexAdapter(
      {
        id: 'aggregator',
        label: 'CYBER ROUTER',
        chainIds: [369, 1, 8453],
        feePct: 0.0012,
        liquidityShare: 0.82,
        router: '0x1111111254EEB25477B68fb85Ed929f73A960582',
        aggregator: true,
      },
      market,
    ),
  );

  const wallets = new WalletService(storage, bus);
  const portfolio = new PortfolioService(bus);
  const ledger = new TransactionLedger(storage, bus);
  const execution = new ExecutionService(ledger, bus);
  const alerts = new AlertEngine(storage, bus);
  const notifications = new NotificationCenter(bus);
  const global = new GlobalContextStore();
  const workspace = new WorkspaceStore(buildDefaultWorkspace(), storage, bus);

  const chainCache = new Map<string, ChainProvider>();
  const chainFor = (chainId: number): ChainProvider => {
    const active = wallets.getActiveWallet();
    const provider = wallets.getExecutionProvider();
    const live = active?.kind === 'injected' && provider !== null;
    const key = `${live ? 'live' : 'demo'}:${chainId}`;
    let chain = chainCache.get(key);
    if (!chain) {
      chain = live ? new EvmChainProvider(provider!, chainId) : new DemoChainProvider(chainId);
      chainCache.set(key, chain);
    }
    return chain;
  };

  const telemetry = new TelemetryService({ chainFor, market, routing, bus });

  // Alert modules own a rule each; when their module goes (deleted, or its deck
  // deleted) the rule must go with it rather than firing into the void.
  let pruneTimer: ReturnType<typeof setTimeout> | null = null;
  workspace.subscribe(() => {
    if (pruneTimer) clearTimeout(pruneTimer);
    pruneTimer = setTimeout(() => {
      pruneTimer = null;
      const live = new Set<string>();
      for (const deck of workspace.getState().decks) {
        for (const module of deck.modules) live.add(module.id);
      }
      alerts.pruneOrphans(live);
    }, 500);
  });

  return {
    bus,
    storage,
    market,
    routing,
    wallets,
    portfolio,
    ledger,
    execution,
    alerts,
    notifications,
    global,
    workspace,
    telemetry,
    runtime: moduleRuntime,
    chainFor,
  };
}

const SystemContext = createContext<System | null>(null);

export function SystemProvider({ system, children }: { system: System; children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all([
        system.workspace.hydrate(),
        system.wallets.hydrate(),
        system.ledger.hydrate(),
        system.alerts.hydrate(),
      ]);
      const prefs = await system.storage.get<{ theme: string; density: 'compact' | 'normal' | 'comfortable' }>(
        STORAGE_KEYS.preferences,
      );
      if (prefs && !cancelled) system.global.set({ theme: prefs.theme, density: prefs.density });
      const active = system.wallets.getActiveWallet();
      if (active && !cancelled) {
        system.global.set({ chainId: active.chainId, demoMode: active.kind !== 'injected' });
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [system]);

  // Keep global chain + demo flag in step with the wallet the user picked.
  useEffect(
    () =>
      system.wallets.subscribe(() => {
        const active = system.wallets.getActiveWallet();
        system.global.set({
          chainId: active?.chainId ?? system.wallets.getState().chainId,
          demoMode: active?.kind !== 'injected',
        });
      }),
    [system],
  );

  // Theme + density are DOM-level tokens; write them once, not per component.
  const theme = useStoreSelector(system.global, (s) => s.theme);
  const density = useStoreSelector(system.global, (s) => s.density);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.density = density;
    void system.storage.set(STORAGE_KEYS.preferences, { theme, density });
  }, [theme, density, system]);

  if (!ready) {
    return (
      <div className="empty" style={{ height: '100%' }}>
        <div className="label">CYBER DEX</div>
        <p>INITIALISING SYSTEM…</p>
      </div>
    );
  }

  return <SystemContext.Provider value={system}>{children}</SystemContext.Provider>;
}

export function useSystem(): System {
  const system = useContext(SystemContext);
  if (!system) throw new Error('useSystem must be used inside <SystemProvider>');
  return system;
}

export function useGlobalContext() {
  const system = useSystem();
  const state = useStoreSelector(system.global, (s) => s);
  return [state, system.global] as const;
}

export function useWalletState() {
  const system = useSystem();
  return useStoreSelector(system.wallets, (s) => s);
}

export function useActiveWallet() {
  const system = useSystem();
  return useStoreSelector(system.wallets, (s) =>
    s.wallets.find((w) => w.id === s.activeWalletId) ?? null,
  );
}

export function useNotifications() {
  const system = useSystem();
  return useStoreSelector(system.notifications, (s) => s);
}

export function useTransactions() {
  const system = useSystem();
  return useStoreSelector(system.ledger, (s) => s);
}

export function useAlertRules() {
  const system = useSystem();
  return useStoreSelector(system.alerts, (s) => s);
}

/**
 * Gas, block and service health for a chain.
 *
 * Every caller shares one poller inside TelemetryService, so adding a second
 * Gas module costs nothing in RPC traffic.
 */
export function useNetworkTelemetry(chainId: number) {
  const system = useSystem();

  const subscribe = useCallback(
    (listener: () => void) => system.telemetry.subscribe(chainId, listener),
    [system, chainId],
  );
  const getSnapshot = useCallback(() => system.telemetry.getSnapshot(chainId), [system, chainId]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const network = useMemo(() => NETWORKS[chainId] ?? null, [chainId]);
  return { gas: snapshot.gas, status: snapshot.status, error: snapshot.error, network };
}

/** Undo/redo availability, kept in sync with the workspace store. */
export function useHistoryDepth() {
  const system = useSystem();
  const subscribe = useCallback((listener: () => void) => system.workspace.subscribe(listener), [system]);
  const getSnapshot = useCallback(() => system.workspace.getHistoryDepth(), [system]);
  const cache = useRef(getSnapshot());
  const stable = useCallback(() => {
    const next = getSnapshot();
    if (next.past !== cache.current.past || next.future !== cache.current.future) cache.current = next;
    return cache.current;
  }, [getSnapshot]);
  return useSyncExternalStore(subscribe, stable, stable);
}
