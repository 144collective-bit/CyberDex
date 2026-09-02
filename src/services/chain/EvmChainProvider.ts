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
import { decodeUint, encodeAllowance, encodeBalanceOf, fromBaseUnits } from './abi';

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

/**
 * Live EVM access over an EIP-1193 provider (the wallet's own transport).
 *
 * Signing is always delegated to the wallet: this class builds calldata and
 * hands it over, and never holds key material of any kind.
 */
export class EvmChainProvider implements ChainProvider {
  readonly id = 'evm';
  readonly origin = 'live' as const;
  readonly chainId: number;
  readonly info: NetworkInfo;
  readonly canSign: boolean;

  private provider: Eip1193Provider;

  constructor(provider: Eip1193Provider, chainId: number, canSign = true) {
    this.provider = provider;
    this.chainId = chainId;
    this.info = NETWORKS[chainId] ?? {
      chainId,
      name: `Chain ${chainId}`,
      shortName: String(chainId),
      nativeSymbol: 'ETH',
      explorerUrl: '',
      demo: false,
    };
    this.canSign = canSign;
  }

  private async call<T = string>(method: string, params: unknown[] = []): Promise<T> {
    return (await this.provider.request({ method, params })) as T;
  }

  async getBlock(): Promise<BlockInfo> {
    const [numberHex, block] = await Promise.all([
      this.call<string>('eth_blockNumber'),
      this.call<{ timestamp: string } | null>('eth_getBlockByNumber', ['latest', false]),
    ]);
    return {
      number: Number(decodeUint(numberHex)),
      timestamp: block ? Number(decodeUint(block.timestamp)) : Math.floor(Date.now() / 1000),
    };
  }

  async getGas(): Promise<GasSnapshot> {
    const [gasPriceHex, block] = await Promise.all([
      this.call<string>('eth_gasPrice'),
      this.getBlock(),
    ]);
    const gwei = Number(decodeUint(gasPriceHex)) / 1e9;
    return {
      chainId: this.chainId,
      baseFeeGwei: gwei,
      priorityFeeGwei: 0,
      blockNumber: block.number,
      blockTimeSec: this.chainId === 369 ? 10 : 12,
      updatedAt: Date.now(),
      simulated: false,
    };
  }

  async getNativeBalance(address: Address): Promise<TokenBalance> {
    const raw = decodeUint(await this.call<string>('eth_getBalance', [address, 'latest']));
    const token: TokenRef = {
      address: 'native',
      symbol: this.info.nativeSymbol,
      name: this.info.nativeSymbol,
      decimals: 18,
      chainId: this.chainId,
    };
    return { token, raw: raw.toString(), amount: fromBaseUnits(raw, 18), valueUsd: 0 };
  }

  async getTokenBalances(address: Address, tokens: TokenRef[]): Promise<TokenBalance[]> {
    // Batched with Promise.all rather than one call per render; a multicall
    // adapter can be dropped in here without touching any module.
    const results = await Promise.all(
      tokens.map(async (token) => {
        if (token.address === 'native') return this.getNativeBalance(address);
        try {
          const hex = await this.call<string>('eth_call', [
            { to: token.address, data: encodeBalanceOf(String(address)) },
            'latest',
          ]);
          const raw = decodeUint(hex);
          return {
            token,
            raw: raw.toString(),
            amount: fromBaseUnits(raw, token.decimals),
            valueUsd: 0,
          } satisfies TokenBalance;
        } catch {
          return { token, raw: '0', amount: 0, valueUsd: 0 } satisfies TokenBalance;
        }
      }),
    );
    return results;
  }

  async getAllowance(token: TokenRef, owner: Address, spender: Address): Promise<bigint> {
    if (token.address === 'native') return 2n ** 255n;
    const hex = await this.call<string>('eth_call', [
      { to: token.address, data: encodeAllowance(String(owner), String(spender)) },
      'latest',
    ]);
    return decodeUint(hex);
  }

  async estimateGas(request: TxRequest): Promise<number> {
    const hex = await this.call<string>('eth_estimateGas', [
      { to: request.to, from: request.from, data: request.data, value: request.value },
    ]);
    return Number(decodeUint(hex));
  }

  async simulateTransaction(request: TxRequest): Promise<SimulationResult> {
    try {
      await this.call('eth_call', [
        { to: request.to, from: request.from, data: request.data, value: request.value },
        'latest',
      ]);
      const gasUsed = await this.estimateGas(request);
      return { ok: true, gasUsed };
    } catch (err) {
      return { ok: false, reason: errorMessage(err) };
    }
  }

  async sendTransaction(request: TxRequest): Promise<TxRecord> {
    if (!this.canSign) throw new Error('This provider is read-only');
    const hash = await this.call<string>('eth_sendTransaction', [
      {
        to: request.to,
        from: request.from,
        data: request.data,
        value: request.value,
      },
    ]);
    return {
      id: hash,
      hash,
      wallet: request.from,
      chainId: this.chainId,
      type: request.data?.startsWith('0x095ea7b3') ? 'APPROVAL' : 'SWAP',
      status: 'PENDING',
      timestamp: Date.now(),
      summary: request.summary,
      simulated: false,
    };
  }

  async getTransaction(hash: string): Promise<TxRecord | null> {
    const receipt = await this.call<{ status: string; from: string } | null>('eth_getTransactionReceipt', [hash]);
    if (!receipt) return null;
    return {
      id: hash,
      hash,
      wallet: receipt.from,
      chainId: this.chainId,
      type: 'SWAP',
      status: decodeUint(receipt.status) === 1n ? 'CONFIRMED' : 'FAILED',
      timestamp: Date.now(),
      summary: 'On-chain transaction',
      simulated: false,
    };
  }

  async health(): Promise<ServiceHealth> {
    try {
      await this.call('eth_blockNumber');
      return 'online';
    } catch {
      return 'offline';
    }
  }
}

export function errorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return 'Unknown error';
}
