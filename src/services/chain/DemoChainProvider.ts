import type {
  Address,
  GasSnapshot,
  NetworkInfo,
  ServiceHealth,
  TokenBalance,
  TokenRef,
  TxRecord,
} from '../../core/types';
import type { BlockInfo, ChainProvider, SimulationResult, TxRequest } from './ChainProvider';
import { NETWORKS } from '../market/tokens';
import { SELECTORS, toBaseUnits } from './abi';

const DEMO_BALANCES: Record<string, number> = {
  PLS: 4_820_000,
  WPLS: 1_250_000,
  HEX: 186_400,
  eHEX: 12_400,
  PLSX: 9_400_000,
  INC: 940,
  DAI: 5_260,
  USDC: 3_180,
  ETH: 1.82,
};

/**
 * Simulated chain.
 *
 * Every record it returns carries `simulated: true` and a `sim:` hash prefix —
 * a demo transaction must never be mistaken for a settled on-chain one.
 */
export class DemoChainProvider implements ChainProvider {
  readonly id = 'demo-chain';
  readonly origin = 'demo' as const;
  readonly canSign = true;
  readonly chainId: number;
  readonly info: NetworkInfo;

  private startBlock: number;
  private startedAt = Date.now();
  private txs = new Map<string, TxRecord>();
  /** Approvals granted in this session: `owner:token:spender` → allowance. */
  private allowances = new Map<string, bigint>();
  private confirmDelayMs: number;

  constructor(chainId: number, confirmDelayMs = 2600) {
    this.chainId = chainId;
    const base = NETWORKS[chainId] ?? NETWORKS[369]!;
    this.info = { ...base, demo: true };
    this.startBlock = 21_400_000 + Math.floor(Math.random() * 10_000);
    this.confirmDelayMs = confirmDelayMs;
  }

  private currentBlock(): number {
    const elapsedSec = (Date.now() - this.startedAt) / 1000;
    return this.startBlock + Math.floor(elapsedSec / 10);
  }

  async getBlock(): Promise<BlockInfo> {
    return { number: this.currentBlock(), timestamp: Math.floor(Date.now() / 1000) };
  }

  async getGas(): Promise<GasSnapshot> {
    const wobble = Math.sin(Date.now() / 45_000) * 0.4 + 1;
    return {
      chainId: this.chainId,
      baseFeeGwei: Math.max(0.4, (this.chainId === 369 ? 8 : 14) * wobble),
      priorityFeeGwei: this.chainId === 369 ? 1.2 : 0.9,
      blockNumber: this.currentBlock(),
      blockTimeSec: 10,
      updatedAt: Date.now(),
      simulated: true,
    };
  }

  private balanceFor(token: TokenRef, address: Address): TokenBalance {
    // Deterministic per address so a demo wallet keeps a stable portfolio.
    const seed = Array.from(String(address)).reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const factor = 0.6 + ((seed % 80) / 100);
    const amount = (DEMO_BALANCES[token.symbol] ?? 0) * factor;
    return {
      token,
      raw: toBaseUnits(amount, token.decimals),
      amount,
      valueUsd: 0, // filled in by the portfolio service, which owns pricing
    };
  }

  async getNativeBalance(address: Address): Promise<TokenBalance> {
    const native: TokenRef = {
      address: 'native',
      symbol: this.info.nativeSymbol,
      name: this.info.nativeSymbol,
      decimals: 18,
      chainId: this.chainId,
    };
    return this.balanceFor(native, address);
  }

  async getTokenBalances(address: Address, tokens: TokenRef[]): Promise<TokenBalance[]> {
    return tokens.map((token) => this.balanceFor(token, address));
  }

  async getAllowance(token: TokenRef, owner: Address, spender: Address): Promise<bigint> {
    // Native never needs approval. Demo ERC-20s start unapproved so the swap
    // module exercises its approval path, then remember what was granted.
    if (token.address === 'native') return 2n ** 255n;
    return this.allowances.get(allowanceKey(owner, token.address, spender)) ?? 0n;
  }

  async estimateGas(request: TxRequest): Promise<number> {
    return request.data && request.data.length > 10 ? 180_000 : 21_000;
  }

  async simulateTransaction(request: TxRequest): Promise<SimulationResult> {
    if (!request.to || !request.from) return { ok: false, reason: 'Missing transaction participants' };
    return { ok: true, gasUsed: await this.estimateGas(request) };
  }

  async sendTransaction(request: TxRequest): Promise<TxRecord> {
    const id = `sim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const record: TxRecord = {
      id,
      // Prefixed, not a real hash — nothing here settled on a chain.
      hash: `sim:${id}`,
      wallet: request.from,
      chainId: this.chainId,
      type: request.data && request.data.startsWith(SELECTORS.approve) ? 'APPROVAL' : 'SWAP',
      status: 'PENDING',
      timestamp: Date.now(),
      summary: request.summary,
      simulated: true,
      metadata: { to: request.to },
    };
    this.txs.set(id, record);
    setTimeout(() => {
      const pending = this.txs.get(id);
      if (!pending) return;
      this.txs.set(id, { ...pending, status: 'CONFIRMED' });
      // An approval only takes effect once it has "confirmed", exactly as on
      // chain — the swap module must wait for it before it can execute.
      const approval = decodeApproval(request.data);
      if (approval) {
        this.allowances.set(
          allowanceKey(request.from, request.to, approval.spender),
          approval.amount,
        );
      }
    }, this.confirmDelayMs);
    return record;
  }

  async getTransaction(hashOrId: string): Promise<TxRecord | null> {
    const id = hashOrId.replace(/^sim:/, '');
    return this.txs.get(id) ?? null;
  }

  async health(): Promise<ServiceHealth> {
    return 'online';
  }
}

function allowanceKey(owner: Address, token: string, spender: string): string {
  return `${String(owner).toLowerCase()}:${token.toLowerCase()}:${spender.toLowerCase()}`;
}

/** Pull the spender and amount back out of approve(address,uint256) calldata. */
function decodeApproval(data: string | undefined): { spender: string; amount: bigint } | null {
  if (!data || !data.startsWith(SELECTORS.approve) || data.length < 10 + 128) return null;
  const body = data.slice(10);
  const spender = `0x${body.slice(24, 64)}`;
  const amount = BigInt(`0x${body.slice(64, 128)}`);
  return { spender, amount };
}
