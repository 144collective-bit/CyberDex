import type { PairRef, TokenRef } from '../core/types';
import { findToken } from '../services/market/tokens';

export interface SwapTokenSources {
  chainId: number;
  /** TOKEN A / TOKEN B ports, when something is wired into them. */
  linkedSell?: TokenRef | null;
  linkedBuy?: TokenRef | null;
  linkedPair?: PairRef | null;
  globalPair?: PairRef | null;
  /** Symbols the user pinned locally on this module. */
  sellOverride?: string | null;
  buyOverride?: string | null;
}

export interface SwapTokens {
  sell: TokenRef | null;
  buy: TokenRef | null;
  /** A link owns this side, so the picker is read-only. */
  sellLocked: boolean;
  buyLocked: boolean;
  /** The module has stopped following its pair because the user chose sides. */
  pinned: boolean;
}

/**
 * Decide which two tokens the swap terminal is trading.
 *
 * Precedence, highest first: a direct token link, then the user's own pick on
 * this module, then a linked pair, then the workspace pair, then a sensible
 * default for the chain. Kept pure so the rule is testable and the component
 * only renders it.
 */
export function resolveSwapTokens(sources: SwapTokenSources): SwapTokens {
  const {
    chainId,
    linkedSell,
    linkedBuy,
    linkedPair,
    globalPair,
    sellOverride,
    buyOverride,
  } = sources;

  const sellLocked = Boolean(linkedSell);
  const buyLocked = Boolean(linkedBuy);

  const overrideSell = !sellLocked && sellOverride ? findToken(chainId, sellOverride) ?? null : null;
  const overrideBuy = !buyLocked && buyOverride ? findToken(chainId, buyOverride) ?? null : null;

  const sell =
    linkedSell ??
    overrideSell ??
    linkedPair?.base ??
    globalPair?.base ??
    findToken(chainId, 'HEX') ??
    findToken(chainId, 'native') ??
    null;

  const buy =
    linkedBuy ??
    overrideBuy ??
    linkedPair?.quote ??
    globalPair?.quote ??
    findToken(chainId, 'PLS') ??
    findToken(chainId, 'native') ??
    null;

  return {
    sell,
    buy,
    sellLocked,
    buyLocked,
    pinned: Boolean(overrideSell || overrideBuy),
  };
}
