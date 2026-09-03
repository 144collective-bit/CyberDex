/**
 * Per-chain contract and endpoint configuration.
 *
 * These addresses are deployment facts, not code: they live here so they can be
 * checked in one place and corrected without touching any logic. Verify them
 * against an explorer before trusting a live deployment — a wrong router
 * address means a broken quote, and a wrong stable pair means a wrong USD
 * price everywhere.
 */
export interface ChainMarketConfig {
  chainId: number;
  name: string;
  /** Tried in order, with failover. */
  rpcEndpoints: string[];
  /** Wrapped native token — the hub every price routes through. */
  wrappedNative: string;
  /** Stablecoins used to anchor USD, best first. */
  stables: { address: string; symbol: string; decimals: number }[];
  /** AMM factories to search for a pair, deepest-liquidity wins. */
  factories: { label: string; address: string }[];
  /** Router used for executable quotes. */
  router: { label: string; address: string };
  nativeDecimals: number;
}

export const CHAIN_MARKET_CONFIG: Record<number, ChainMarketConfig> = {
  369: {
    chainId: 369,
    name: 'PulseChain',
    rpcEndpoints: [
      'https://rpc.pulsechain.com',
      'https://pulsechain-rpc.publicnode.com',
      'https://rpc-pulsechain.g4mm4.io',
    ],
    wrappedNative: '0xA1077a294dDE1B09bB078844df40758a5D0f9a27', // WPLS
    stables: [
      { address: '0xefD766cCb38EaF1dfd701853BFCe31359239F305', symbol: 'DAI', decimals: 18 },
      { address: '0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07', symbol: 'USDC', decimals: 6 },
    ],
    factories: [
      { label: 'PULSEX V2', address: '0x29eA7545DEf87022BAdc76323F373EA1e707C523' },
      { label: 'PULSEX V1', address: '0x1715a3E4A142d8b698131108995174F37aEBA10D' },
    ],
    router: { label: 'PULSEX V2', address: '0x165C3410fC91EF562C50559f7d2289fEbed552d9' },
    nativeDecimals: 18,
  },
};

export function getChainMarketConfig(chainId: number): ChainMarketConfig | null {
  return CHAIN_MARKET_CONFIG[chainId] ?? null;
}
