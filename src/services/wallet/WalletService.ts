import type { EventBus } from '../../core/events/bus';
import type { PersistenceAdapter } from '../../core/storage/PersistenceAdapter';
import { STORAGE_KEYS } from '../../core/storage/PersistenceAdapter';
import type { WalletKind, WalletRecord } from '../../core/types';
import type { Eip1193Provider } from '../chain/EvmChainProvider';
import { errorMessage } from '../chain/EvmChainProvider';
import { DEFAULT_CHAIN_ID } from '../market/tokens';

export interface WalletState {
  wallets: WalletRecord[];
  activeWalletId: string | null;
  chainId: number;
  injectedAvailable: boolean;
  connecting: boolean;
  error: string | null;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { isMetaMask?: boolean; chainId?: string };
  }
}

const DEMO_ADDRESS = '0x82Ae4bC0f4A1b9E7B85e0Fa9D1A3C7f2E5a83791';

export function shortAddress(address: string, size = 4): string {
  if (!address) return '';
  if (address.length <= size * 2 + 2) return address;
  return `${address.slice(0, size + 2)}…${address.slice(-size)}`;
}

export function isAddressLike(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

/**
 * Wallet registry and connection manager.
 *
 * Hard rule enforced here rather than in the UI: a wallet is either an
 * execution wallet (signing delegated to its provider) or a watch wallet
 * (`watchOnly`, can never sign). No key material is read, stored or requested.
 */
export class WalletService {
  private state: WalletState;
  private listeners = new Set<() => void>();
  private adapter: PersistenceAdapter;
  private bus: EventBus;
  private injected: Eip1193Provider | null;

  constructor(adapter: PersistenceAdapter, bus: EventBus, injected: Eip1193Provider | null = null) {
    this.adapter = adapter;
    this.bus = bus;
    this.injected = injected ?? (typeof window !== 'undefined' ? window.ethereum ?? null : null);
    this.state = {
      wallets: [],
      activeWalletId: null,
      chainId: DEFAULT_CHAIN_ID,
      injectedAvailable: Boolean(this.injected),
      connecting: false,
      error: null,
    };
  }

  getState = (): WalletState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getActiveWallet(): WalletRecord | null {
    return this.state.wallets.find((w) => w.id === this.state.activeWalletId) ?? null;
  }

  getExecutionProvider(): Eip1193Provider | null {
    return this.injected;
  }

  private set(patch: Partial<WalletState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of Array.from(this.listeners)) listener();
  }

  private persist(): void {
    void this.adapter.set(STORAGE_KEYS.wallets, {
      wallets: this.state.wallets.filter((w) => w.kind !== 'injected'),
      activeWalletId: this.state.activeWalletId,
      chainId: this.state.chainId,
    });
  }

  async hydrate(): Promise<void> {
    const stored = await this.adapter.get<{
      wallets: WalletRecord[];
      activeWalletId: string | null;
      chainId: number;
    }>(STORAGE_KEYS.wallets);
    if (!stored) return;
    const wallets = Array.isArray(stored.wallets) ? stored.wallets : [];
    this.set({
      wallets,
      activeWalletId: wallets.some((w) => w.id === stored.activeWalletId) ? stored.activeWalletId : wallets[0]?.id ?? null,
      chainId: stored.chainId ?? DEFAULT_CHAIN_ID,
    });
    const active = this.getActiveWallet();
    if (active) this.bus.emit('WALLET_CHANGED', { wallet: active }, 'wallet-service');
  }

  private add(record: WalletRecord, activate = true): WalletRecord {
    const existing = this.state.wallets.find(
      (w) => w.address.toLowerCase() === record.address.toLowerCase() && w.kind === record.kind,
    );
    if (existing) {
      if (activate) this.setActive(existing.id);
      return existing;
    }
    const wallets = [...this.state.wallets, record];
    this.set({ wallets, activeWalletId: activate ? record.id : this.state.activeWalletId, error: null });
    this.persist();
    if (activate) this.bus.emit('WALLET_CHANGED', { wallet: record }, 'wallet-service');
    return record;
  }

  /** Read-only wallet: analysis only, signing is refused downstream. */
  addWatchWallet(address: string, label?: string): WalletRecord {
    if (!isAddressLike(address)) throw new Error('That is not a valid EVM address');
    return this.add({
      id: `watch_${address.toLowerCase()}`,
      address,
      label: label?.trim() || `WATCH ${shortAddress(address)}`,
      chainId: this.state.chainId,
      kind: 'watch',
      watchOnly: true,
      addedAt: Date.now(),
    });
  }

  /** Demo wallet: drives the whole terminal without connecting anything real. */
  addDemoWallet(): WalletRecord {
    const wallet = this.add({
      id: 'demo_wallet',
      address: DEMO_ADDRESS,
      label: 'DEMO VAULT',
      chainId: this.state.chainId,
      kind: 'demo',
      watchOnly: false,
      addedAt: Date.now(),
    });
    this.bus.emit('WALLET_CONNECTED', { wallet }, 'wallet-service');
    return wallet;
  }

  async connectInjected(): Promise<WalletRecord> {
    if (!this.injected) {
      const message = 'No browser wallet detected. Install a wallet extension or use the demo vault.';
      this.set({ error: message });
      throw new Error(message);
    }
    this.set({ connecting: true, error: null });
    try {
      const accounts = (await this.injected.request({ method: 'eth_requestAccounts' })) as string[];
      const address = accounts?.[0];
      if (!address) throw new Error('Wallet returned no account');
      const chainIdHex = (await this.injected.request({ method: 'eth_chainId' })) as string;
      const chainId = Number(BigInt(chainIdHex));
      const wallet: WalletRecord = {
        id: `injected_${address.toLowerCase()}`,
        address,
        label: `WALLET ${shortAddress(address)}`,
        chainId,
        kind: 'injected',
        watchOnly: false,
        addedAt: Date.now(),
      };
      this.set({ connecting: false, chainId });
      const added = this.add(wallet);
      this.bus.emit('WALLET_CONNECTED', { wallet: added }, 'wallet-service');
      this.bus.emit('NETWORK_CHANGED', { chainId }, 'wallet-service');
      this.watchInjectedEvents();
      return added;
    } catch (err) {
      const message = errorMessage(err);
      this.set({ connecting: false, error: message });
      throw new Error(message);
    }
  }

  private injectedWatchersBound = false;
  private watchInjectedEvents(): void {
    if (this.injectedWatchersBound || !this.injected?.on) return;
    this.injectedWatchersBound = true;
    this.injected.on('accountsChanged', (...args: unknown[]) => {
      const accounts = (args[0] as string[]) ?? [];
      if (!accounts.length) {
        const active = this.getActiveWallet();
        if (active?.kind === 'injected') this.disconnect(active.id);
        return;
      }
      const address = accounts[0]!;
      this.add({
        id: `injected_${address.toLowerCase()}`,
        address,
        label: `WALLET ${shortAddress(address)}`,
        chainId: this.state.chainId,
        kind: 'injected',
        watchOnly: false,
        addedAt: Date.now(),
      });
    });
    this.injected.on('chainChanged', (...args: unknown[]) => {
      const chainId = Number(BigInt(String(args[0])));
      this.setChain(chainId);
    });
  }

  disconnect(walletId: string): void {
    const wallet = this.state.wallets.find((w) => w.id === walletId);
    if (!wallet) return;
    const wallets = this.state.wallets.filter((w) => w.id !== walletId);
    const activeWalletId = this.state.activeWalletId === walletId ? wallets[0]?.id ?? null : this.state.activeWalletId;
    this.set({ wallets, activeWalletId });
    this.persist();
    this.bus.emit('WALLET_DISCONNECTED', { address: String(wallet.address) }, 'wallet-service');
    this.bus.emit('WALLET_CHANGED', { wallet: this.getActiveWallet() }, 'wallet-service');
  }

  setActive(walletId: string | null): void {
    if (walletId === this.state.activeWalletId) return;
    this.set({ activeWalletId: walletId });
    this.persist();
    this.bus.emit('WALLET_CHANGED', { wallet: this.getActiveWallet() }, 'wallet-service');
  }

  setChain(chainId: number): void {
    if (chainId === this.state.chainId) return;
    this.set({ chainId });
    this.persist();
    this.bus.emit('NETWORK_CHANGED', { chainId }, 'wallet-service');
  }

  async requestChainSwitch(chainId: number): Promise<boolean> {
    const active = this.getActiveWallet();
    if (!this.injected || active?.kind !== 'injected') {
      this.setChain(chainId);
      return true;
    }
    try {
      await this.injected.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      });
      this.setChain(chainId);
      return true;
    } catch (err) {
      this.set({ error: errorMessage(err) });
      return false;
    }
  }

  canSign(wallet: WalletRecord | null = this.getActiveWallet()): boolean {
    return Boolean(wallet && !wallet.watchOnly);
  }

  labelFor(kind: WalletKind): string {
    switch (kind) {
      case 'injected':
        return 'EXECUTION';
      case 'demo':
        return 'DEMO';
      case 'watch':
        return 'WATCH ONLY';
    }
  }
}
