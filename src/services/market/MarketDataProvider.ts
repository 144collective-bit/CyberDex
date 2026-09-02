import type {
  Candle,
  DataOrigin,
  PairRef,
  ServiceHealth,
  Timeframe,
  TokenMarket,
  TokenRef,
  WhaleMovement,
} from '../../core/types';

export interface LiquiditySnapshot {
  pair: PairRef;
  totalUsd: number;
  venues: { dex: string; usd: number; sharePct: number }[];
  change24hPct: number;
  updatedAt: number;
  simulated: boolean;
}

/**
 * Every market read in the app goes through this interface. Swapping to a live
 * indexer means implementing it once — no module changes.
 */
export interface MarketDataProvider {
  readonly id: string;
  readonly label: string;
  readonly origin: DataOrigin;

  listTokens(chainId: number): Promise<TokenRef[]>;
  getToken(chainId: number, addressOrSymbol: string): Promise<TokenRef | null>;
  getMarket(token: TokenRef): Promise<TokenMarket>;
  getMarkets(tokens: TokenRef[]): Promise<TokenMarket[]>;
  getOHLC(pair: PairRef, timeframe: Timeframe, limit?: number): Promise<Candle[]>;
  getLiquidity(pair: PairRef): Promise<LiquiditySnapshot>;
  getWhaleMovements(chainId: number, limit?: number): Promise<WhaleMovement[]>;
  /** Push updates; returns an unsubscribe. Implementations may poll instead. */
  subscribePrice(token: TokenRef, handler: (market: TokenMarket) => void): () => void;
  health(): Promise<ServiceHealth>;
}

/** Ratio of base priced in quote, e.g. HEX/PLS. */
export function pairRatio(baseUsd: number, quoteUsd: number): number {
  if (!quoteUsd) return 0;
  return baseUsd / quoteUsd;
}

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
};
