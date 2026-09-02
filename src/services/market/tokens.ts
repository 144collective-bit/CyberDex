import type { NetworkInfo, PairRef, TokenRef } from '../../core/types';

export const NETWORKS: Record<number, NetworkInfo> = {
  369: {
    chainId: 369,
    name: 'PulseChain',
    shortName: 'PLS',
    nativeSymbol: 'PLS',
    explorerUrl: 'https://otter.pulsechain.com',
    demo: false,
  },
  1: {
    chainId: 1,
    name: 'Ethereum',
    shortName: 'ETH',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://etherscan.io',
    demo: false,
  },
  8453: {
    chainId: 8453,
    name: 'Base',
    shortName: 'BASE',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://basescan.org',
    demo: false,
  },
};

export const DEFAULT_CHAIN_ID = 369;

const t = (
  chainId: number,
  address: string,
  symbol: string,
  name: string,
  decimals: number,
  color: string,
  verified = true,
  tags: string[] = [],
): TokenRef => ({ chainId, address, symbol, name, decimals, color, verified, tags });

export const TOKENS: TokenRef[] = [
  // ---- PulseChain ----
  t(369, 'native', 'PLS', 'Pulse', 18, '#4aa8ff', true, ['native', 'gas']),
  t(369, '0xA1077a294dDE1B09bB078844df40758a5D0f9a27', 'WPLS', 'Wrapped Pulse', 18, '#3d8fd6', true, ['wrapped']),
  t(369, '0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39', 'HEX', 'HEX', 8, '#ff4d9d', true, ['staking']),
  t(369, '0x95B303987A60C71504D99Aa1b13B4DA07b0790ab', 'PLSX', 'PulseX', 18, '#35e6c0', true, ['dex']),
  t(369, '0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d', 'INC', 'Incentive', 18, '#f0b429', true, ['dex']),
  t(369, '0xefD766cCb38EaF1dfd701853BFCe31359239F305', 'DAI', 'Dai (from Ethereum)', 18, '#f5ac37', true, ['stable']),
  t(369, '0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07', 'USDC', 'USD Coin (from Ethereum)', 6, '#2775ca', true, ['stable']),
  t(369, '0x57fde0a71132198BBeC939B98976993d8D89D225', 'eHEX', 'HEX (from Ethereum)', 8, '#b28dff', true, ['staking']),
  // ---- Ethereum ----
  t(1, 'native', 'ETH', 'Ether', 18, '#8a92b2', true, ['native', 'gas']),
  t(1, '0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39', 'HEX', 'HEX', 8, '#ff4d9d', true, ['staking']),
  t(1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC', 'USD Coin', 6, '#2775ca', true, ['stable']),
  t(1, '0x6B175474E89094C44Da98b954EedeAC495271d0F', 'DAI', 'Dai', 18, '#f5ac37', true, ['stable']),
  // ---- Base ----
  t(8453, 'native', 'ETH', 'Ether', 18, '#8a92b2', true, ['native', 'gas']),
  t(8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USDC', 'USD Coin', 6, '#2775ca', true, ['stable']),
];

export function tokensForChain(chainId: number): TokenRef[] {
  return TOKENS.filter((token) => token.chainId === chainId);
}

export function findToken(chainId: number, addressOrSymbol: string): TokenRef | undefined {
  const needle = addressOrSymbol.toLowerCase();
  return TOKENS.find(
    (token) =>
      token.chainId === chainId &&
      (token.address.toLowerCase() === needle || token.symbol.toLowerCase() === needle),
  );
}

export function nativeToken(chainId: number): TokenRef {
  return findToken(chainId, 'native') ?? TOKENS[0]!;
}

export function pairId(base: TokenRef, quote: TokenRef): string {
  return `${base.chainId}:${base.address}/${quote.address}`;
}

export function makePair(base: TokenRef, quote: TokenRef): PairRef {
  return { id: pairId(base, quote), base, quote, label: `${base.symbol}/${quote.symbol}` };
}

export function sameToken(a?: TokenRef | null, b?: TokenRef | null): boolean {
  if (!a || !b) return false;
  return a.chainId === b.chainId && a.address.toLowerCase() === b.address.toLowerCase();
}
