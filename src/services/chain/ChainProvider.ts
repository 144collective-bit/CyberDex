import type {
  Address,
  DataOrigin,
  GasSnapshot,
  NetworkInfo,
  ServiceHealth,
  TokenBalance,
  TokenRef,
  TxRecord,
} from '../../core/types';

export interface TxRequest {
  to: string;
  from: string;
  data?: string;
  value?: string;
  chainId: number;
  /** Human-readable description shown on the confirmation screen. */
  summary: string;
}

export interface SimulationResult {
  ok: boolean;
  gasUsed?: number;
  reason?: string;
}

export interface BlockInfo {
  number: number;
  timestamp: number;
}

/**
 * Chain access contract. Chains are not assumed to behave identically — an
 * adapter may report `unknown` health or refuse simulation, and callers must
 * handle that rather than assuming EVM mainnet semantics everywhere.
 */
export interface ChainProvider {
  readonly id: string;
  readonly chainId: number;
  readonly info: NetworkInfo;
  readonly origin: DataOrigin;
  /** False for read-only providers (watch wallets, public RPC without signer). */
  readonly canSign: boolean;

  getBlock(): Promise<BlockInfo>;
  getGas(): Promise<GasSnapshot>;
  getNativeBalance(address: Address): Promise<TokenBalance>;
  getTokenBalances(address: Address, tokens: TokenRef[]): Promise<TokenBalance[]>;
  getAllowance(token: TokenRef, owner: Address, spender: Address): Promise<bigint>;
  estimateGas(request: TxRequest): Promise<number>;
  simulateTransaction(request: TxRequest): Promise<SimulationResult>;
  sendTransaction(request: TxRequest): Promise<TxRecord>;
  getTransaction(hash: string): Promise<TxRecord | null>;
  health(): Promise<ServiceHealth>;
}
