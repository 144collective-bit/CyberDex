import type { PairRef, Timeframe, TokenRef } from '../core/types';
import { DEFAULT_CHAIN_ID, findToken, makePair } from '../services/market/tokens';

export interface GlobalContextState {
  chainId: number;
  token: TokenRef | null;
  pair: PairRef | null;
  timeframe: Timeframe;
  currency: 'USD';
  /** True until a real execution wallet is connected. */
  demoMode: boolean;
  theme: string;
  density: 'compact' | 'normal' | 'comfortable';
}

function defaultPair(): PairRef | null {
  const hex = findToken(DEFAULT_CHAIN_ID, 'HEX');
  const pls = findToken(DEFAULT_CHAIN_ID, 'PLS');
  return hex && pls ? makePair(hex, pls) : null;
}

/**
 * Workspace-wide selections.
 *
 * Modules may read this, ignore it, or be driven entirely through links —
 * global state is an option, never an obligation.
 */
export class GlobalContextStore {
  private state: GlobalContextState;
  private listeners = new Set<() => void>();

  constructor(initial?: Partial<GlobalContextState>) {
    const pair = defaultPair();
    this.state = {
      chainId: DEFAULT_CHAIN_ID,
      token: pair?.base ?? null,
      pair,
      timeframe: '1h',
      currency: 'USD',
      demoMode: true,
      theme: 'cyber-dark',
      density: 'compact',
      ...initial,
    };
  }

  getState = (): GlobalContextState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(patch: Partial<GlobalContextState>): void {
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.is(this.state[key as keyof GlobalContextState], value)) changed = true;
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of Array.from(this.listeners)) listener();
  }
}
