import type { Quote, RouteLeg, TokenRef } from '../../core/types';
import type { TxRequest } from '../chain/ChainProvider';

export interface QuoteRequest {
  source: TokenRef;
  dest: TokenRef;
  amountIn: number;
  slippagePct: number;
  chainId: number;
  /** Needed for allowance checks and for building a transaction. */
  taker?: string | null;
}

export interface AllowanceStatus {
  needsApproval: boolean;
  allowance: bigint;
  spender: string;
}

/**
 * Every venue — single DEX or aggregator — implements this. The UI never names
 * a protocol; it asks the routing engine, which asks the adapters.
 */
export interface DexAdapter {
  readonly id: string;
  readonly label: string;
  readonly chainIds: number[];
  readonly aggregator: boolean;
  /** Router contract that must hold the ERC-20 allowance. */
  routerAddress(chainId: number): string;

  getQuote(request: QuoteRequest): Promise<Quote>;
  getRoutes(request: QuoteRequest): Promise<RouteLeg[]>;
  buildTransaction(quote: Quote, taker: string): Promise<TxRequest>;
  estimateGas(quote: Quote): Promise<number>;
}

export class QuoteError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'QuoteError';
  }
}
