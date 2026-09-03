import type { Quote, RouteLeg } from '../../../core/types';
import type { TxRequest } from '../../chain/ChainProvider';
import type { DexAdapter, QuoteRequest } from '../DexAdapter';
import { QuoteError } from '../DexAdapter';
import { JsonRpcClient } from '../../chain/JsonRpcClient';
import {
  decodeAmounts,
  decodeReserves,
  encodeApprove,
  encodeGetAmountsOut,
  encodeGetPair,
  encodeGetReserves,
  decodeAddress,
  fromBaseUnits,
  toBaseUnits,
} from '../../chain/abi';
import { getChainMarketConfig } from '../../chain/chainConfig';
import type { ChainMarketConfig } from '../../chain/chainConfig';
import { priceImpactPct } from '../../market/onchain/priceMath';

/**
 * Quotes from the router that will execute the trade.
 *
 * `getAmountsOut` is the same function the swap goes through, so the number
 * shown is the number the chain would produce for that path at that block —
 * not an indexer's approximation of it. Price impact is computed from the
 * pool's own reserves rather than inferred.
 */
export class PulseXOnChainAdapter implements DexAdapter {
  readonly id = 'pulsex-onchain';
  readonly label = 'PULSEX (ON-CHAIN)';
  readonly chainIds: number[];
  readonly aggregator = false;

  private rpc: JsonRpcClient;
  private config: ChainMarketConfig;
  private pairCache = new Map<string, string | null>();

  constructor(options: { chainId?: number; rpc?: JsonRpcClient } = {}) {
    const chainId = options.chainId ?? 369;
    const config = getChainMarketConfig(chainId);
    if (!config) throw new Error(`No on-chain configuration for chain ${chainId}`);
    this.config = config;
    this.chainIds = [chainId];
    this.rpc = options.rpc ?? new JsonRpcClient({ endpoints: config.rpcEndpoints });
  }

  routerAddress(): string {
    return this.config.router.address;
  }

  private addressOf(token: { address: string }): string {
    return token.address === 'native' ? this.config.wrappedNative : token.address;
  }

  /** Direct pair when one exists, otherwise hop through the wrapped native. */
  async getRoutes(request: QuoteRequest): Promise<RouteLeg[]> {
    const path = await this.resolvePath(request);
    return [
      {
        dex: this.config.router.label,
        portionPct: 100,
        path: path.map((address) =>
          address.toLowerCase() === this.config.wrappedNative.toLowerCase()
            ? `W${request.source.symbol === 'PLS' ? 'PLS' : 'NATIVE'}`
            : address,
        ),
      },
    ];
  }

  private async resolvePath(request: QuoteRequest): Promise<string[]> {
    const from = this.addressOf(request.source);
    const to = this.addressOf(request.dest);
    if (from.toLowerCase() === to.toLowerCase()) {
      throw new QuoteError('SAME_TOKEN', 'Source and destination are the same token');
    }

    const direct = await this.findPair(from, to);
    if (direct) return [from, to];

    const wrapped = this.config.wrappedNative;
    if (from.toLowerCase() !== wrapped.toLowerCase() && to.toLowerCase() !== wrapped.toLowerCase()) {
      return [from, wrapped, to];
    }
    throw new QuoteError('NO_ROUTE', `No pool connects ${request.source.symbol} and ${request.dest.symbol}`);
  }

  private async findPair(tokenA: string, tokenB: string): Promise<string | null> {
    const key = [tokenA.toLowerCase(), tokenB.toLowerCase()].sort().join('/');
    const cached = this.pairCache.get(key);
    if (cached !== undefined) return cached;

    const results = await this.rpc.callMany(
      this.config.factories.map((factory) => ({ to: factory.address, data: encodeGetPair(tokenA, tokenB) })),
    );
    const address = results.reduce<string | null>((found, hex) => found ?? (hex ? decodeAddress(hex) : null), null);
    this.pairCache.set(key, address);
    return address;
  }

  async getQuote(request: QuoteRequest): Promise<Quote> {
    if (!this.chainIds.includes(request.chainId)) {
      throw new QuoteError('UNSUPPORTED_NETWORK', `${this.label} does not serve chain ${request.chainId}`);
    }
    if (!(request.amountIn > 0)) throw new QuoteError('INVALID_AMOUNT', 'Amount must be greater than zero');

    const path = await this.resolvePath(request);
    const amountInRaw = BigInt(toBaseUnits(request.amountIn, request.source.decimals));

    // Pin the read: the quote and the impact must describe the same block.
    const blockNumber = await this.rpc.blockNumber();
    const block = `0x${blockNumber.toString(16)}`;

    const [amountsHex] = await this.rpc.callMany(
      [{ to: this.config.router.address, data: encodeGetAmountsOut(amountInRaw, path) }],
      block,
    );
    if (!amountsHex) throw new QuoteError('QUOTE_FAILED', 'Router did not return a quote');

    const amounts = decodeAmounts(amountsHex);
    const outRaw = amounts[amounts.length - 1];
    if (outRaw === undefined || outRaw <= 0n) {
      throw new QuoteError('NO_LIQUIDITY', 'Route returned no output — the pool may be empty');
    }

    const amountOut = fromBaseUnits(outRaw, request.dest.decimals);
    const minAmountOut = amountOut * (1 - request.slippagePct / 100);

    // Impact comes from the first hop's reserves, where most of it is incurred.
    let impact = 0;
    const firstPair = await this.findPair(path[0]!, path[1]!);
    if (firstPair) {
      const [reservesHex, token0Hex] = await this.rpc.callMany(
        [
          { to: firstPair, data: encodeGetReserves() },
          { to: firstPair, data: '0x0dfe1681' },
        ],
        block,
      );
      const reserves = reservesHex ? decodeReserves(reservesHex) : null;
      const token0 = token0Hex ? decodeAddress(token0Hex) : null;
      if (reserves && token0) {
        const inIsToken0 = token0.toLowerCase() === path[0]!.toLowerCase();
        impact = priceImpactPct(
          amountInRaw,
          inIsToken0 ? reserves.reserve0 : reserves.reserve1,
          inIsToken0 ? reserves.reserve1 : reserves.reserve0,
        );
      }
    }

    const gasEstimate = path.length > 2 ? 235_000 : 168_000;
    return {
      id: `${this.id}_${blockNumber}_${Date.now().toString(36)}`,
      adapterId: this.id,
      adapterLabel: this.label,
      source: request.source,
      dest: request.dest,
      amountIn: request.amountIn,
      amountOut,
      minAmountOut,
      priceImpactPct: impact,
      slippagePct: request.slippagePct,
      gasEstimate,
      // Filled in by the caller, which knows the current gas price.
      gasCostUsd: 0,
      route: await this.getRoutes(request),
      warnings: [],
      createdAt: Date.now(),
      simulated: false,
    };
  }

  async estimateGas(quote: Quote): Promise<number> {
    return quote.gasEstimate;
  }

  async buildTransaction(quote: Quote, taker: string): Promise<TxRequest> {
    if (!taker) throw new QuoteError('NO_TAKER', 'A wallet is required to build a transaction');
    const path = await this.resolvePath({
      source: quote.source,
      dest: quote.dest,
      amountIn: quote.amountIn,
      slippagePct: quote.slippagePct,
      chainId: quote.source.chainId,
    });

    // swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
    const selector = '0x38ed1739';
    const amountIn = toBaseUnits(quote.amountIn, quote.source.decimals);
    const minOut = toBaseUnits(quote.minAmountOut, quote.dest.decimals);
    const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
    const head =
      pad(amountIn) + pad(minOut) + pad(160) + padAddressWord(taker) + pad(deadline);
    const tail = pad(path.length) + path.map((address) => padAddressWord(address)).join('');

    return {
      to: this.config.router.address,
      from: taker,
      data: selector + head + tail,
      value: quote.source.address === 'native' ? amountIn : '0',
      chainId: quote.source.chainId,
      summary: `Swap ${quote.amountIn} ${quote.source.symbol} → ${quote.dest.symbol} via ${this.config.router.label}`,
    };
  }

  buildApproval(quote: Quote, taker: string): TxRequest {
    return {
      to: String(quote.source.address),
      from: taker,
      data: encodeApprove(this.config.router.address, BigInt(toBaseUnits(quote.amountIn, quote.source.decimals))),
      value: '0',
      chainId: quote.source.chainId,
      summary: `Approve ${quote.source.symbol} for ${this.config.router.label}`,
    };
  }
}

function pad(value: bigint | string | number): string {
  return BigInt(value).toString(16).padStart(64, '0');
}

function padAddressWord(address: string): string {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}
