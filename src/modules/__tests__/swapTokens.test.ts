import { describe, expect, it } from 'vitest';
import { resolveSwapTokens } from '../swapTokens';
import { findToken, makePair } from '../../services/market/tokens';

const hex = findToken(369, 'HEX')!;
const pls = findToken(369, 'PLS')!;
const plsx = findToken(369, 'PLSX')!;
const inc = findToken(369, 'INC')!;
const hexPls = makePair(hex, pls);

describe('resolveSwapTokens', () => {
  it('follows a linked pair when nothing else is set', () => {
    const result = resolveSwapTokens({ chainId: 369, linkedPair: hexPls });
    expect(result.sell?.symbol).toBe('HEX');
    expect(result.buy?.symbol).toBe('PLS');
    expect(result.pinned).toBe(false);
    expect(result.sellLocked).toBe(false);
  });

  it('falls back to the workspace pair, then to chain defaults', () => {
    expect(resolveSwapTokens({ chainId: 369, globalPair: makePair(plsx, inc) }).sell?.symbol).toBe('PLSX');
    const bare = resolveSwapTokens({ chainId: 369 });
    expect(bare.sell?.symbol).toBe('HEX');
    expect(bare.buy?.symbol).toBe('PLS');
  });

  it('lets a local pick override the pair, and reports the module as pinned', () => {
    const result = resolveSwapTokens({ chainId: 369, linkedPair: hexPls, sellOverride: 'PLSX' });
    expect(result.sell?.symbol).toBe('PLSX');
    expect(result.buy?.symbol).toBe('PLS');
    expect(result.pinned).toBe(true);
  });

  it('gives a token link precedence over a local pick and locks that side', () => {
    const result = resolveSwapTokens({
      chainId: 369,
      linkedSell: inc,
      sellOverride: 'PLSX',
      linkedPair: hexPls,
    });
    expect(result.sell?.symbol).toBe('INC');
    expect(result.sellLocked).toBe(true);
    // An override the link overrules must not count as pinning the module.
    expect(result.pinned).toBe(false);
  });

  it('locks each side independently', () => {
    const result = resolveSwapTokens({ chainId: 369, linkedBuy: inc, linkedPair: hexPls });
    expect(result.sellLocked).toBe(false);
    expect(result.buyLocked).toBe(true);
    expect(result.sell?.symbol).toBe('HEX');
    expect(result.buy?.symbol).toBe('INC');
  });

  it('ignores an override naming a token that is not on this chain', () => {
    const result = resolveSwapTokens({ chainId: 369, linkedPair: hexPls, sellOverride: 'NOT_A_TOKEN' });
    expect(result.sell?.symbol).toBe('HEX');
    expect(result.pinned).toBe(false);
  });

  it('round-trips a flip: swapping both overrides swaps the sides', () => {
    const before = resolveSwapTokens({ chainId: 369, linkedPair: hexPls });
    const flipped = resolveSwapTokens({
      chainId: 369,
      linkedPair: hexPls,
      sellOverride: before.buy!.symbol,
      buyOverride: before.sell!.symbol,
    });
    expect(flipped.sell?.symbol).toBe('PLS');
    expect(flipped.buy?.symbol).toBe('HEX');
    const flippedBack = resolveSwapTokens({
      chainId: 369,
      linkedPair: hexPls,
      sellOverride: flipped.buy!.symbol,
      buyOverride: flipped.sell!.symbol,
    });
    expect(flippedBack.sell?.symbol).toBe('HEX');
    expect(flippedBack.buy?.symbol).toBe('PLS');
  });
});
