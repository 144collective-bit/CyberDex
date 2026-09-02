import type { Quote, RouteLeg } from '../../../core/types';
import type { TxRequest } from '../../chain/ChainProvider';
import type { DexAdapter, QuoteRequest } from '../DexAdapter';
import { QuoteError } from '../DexAdapter';
import type { MarketDataProvider } from '../../market/MarketDataProvider';
import { sameToken } from '../../market/tokens';
import { encodeApprove, toBaseUnits } from '../../chain/abi';

export interface DemoDexConfig {
  id: string;
  label: string;
  chainIds: number[];
  /** Venue fee, e.g. 0.0029 for 29 bps. */
  feePct: number;
  /** Share of the pair's liquidity this venue holds — drives price impact. */
  liquidityShare: number;
  router: string;
  aggregator?: boolean;
  /** Venues that must hop through the wrapped native token. */
  requiresHop?: boolean;
}

/**
 * A demo venue. It prices from the market provider and applies a real constant
 * product impact curve, so quotes move with size the way an AMM does — but
 * every quote is flagged `simulated`.
 */
export class DemoDexAdapter implements DexAdapter {
  readonly id: string;
  readonly label: string;
  readonly chainIds: number[];
  readonly aggregator: boolean;

  private config: DemoDexConfig;
  private market: MarketDataProvider;

  constructor(config: DemoDexConfig, market: MarketDataProvider) {
    this.config = config;
    this.id = config.id;
    this.label = config.label;
    this.chainIds = config.chainIds;
    this.aggregator = config.aggregator ?? false;
    this.market = market;
  }

  routerAddress(_chainId: number): string {
    return this.config.router;
  }

  async getRoutes(request: QuoteRequest): Promise<RouteLeg[]> {
    const direct = [request.source.symbol, request.dest.symbol];
    const hopped = [request.source.symbol, 'WPLS', request.dest.symbol];
    const path = this.config.requiresHop && !direct.includes('WPLS') ? hopped : direct;
    return [{ dex: this.label, portionPct: 100, path }];
  }

  async getQuote(request: QuoteRequest): Promise<Quote> {
    if (!this.chainIds.includes(request.chainId)) {
      throw new QuoteError('UNSUPPORTED_NETWORK', `${this.label} does not serve chain ${request.chainId}`);
    }
    if (sameToken(request.source, request.dest)) {
      throw new QuoteError('SAME_TOKEN', 'Source and destination are the same token');
    }
    if (!(request.amountIn > 0)) {
      throw new QuoteError('INVALID_AMOUNT', 'Amount must be greater than zero');
    }

    const [sourceMarket, destMarket, liquidity] = await Promise.all([
      this.market.getMarket(request.source),
      this.market.getMarket(request.dest),
      this.market.getLiquidity({
        id: `${request.chainId}:${request.source.address}/${request.dest.address}`,
        base: request.source,
        quote: request.dest,
        label: `${request.source.symbol}/${request.dest.symbol}`,
      }),
    ]);

    if (!destMarket.priceUsd) throw new QuoteError('NO_PRICE', `No price available for ${request.dest.symbol}`);

    const venueLiquidityUsd = Math.max(1, liquidity.totalUsd * this.config.liquidityShare);
    const tradeUsd = request.amountIn * sourceMarket.priceUsd;

    // Constant-product impact: out = in * L / (L + in), expressed as a percentage.
    const impactFraction = tradeUsd / (venueLiquidityUsd + tradeUsd);
    const priceImpactPct = impactFraction * 100;

    const grossOut = (tradeUsd / destMarket.priceUsd);
    const amountOut = grossOut * (1 - this.config.feePct) * (1 - impactFraction);
    const minAmountOut = amountOut * (1 - request.slippagePct / 100);
    const gasEstimate = this.config.requiresHop ? 235_000 : 168_000;
    // Demo fee estimate. A live adapter reads gas price from the ChainProvider;
    // here we assume a nominal price so the cost line is populated.
    const nominalGasPriceGwei = 9;
    const nativePriceUsd = request.chainId === 369 ? 0.0000342 : 3420;

    return {
      id: `${this.id}_${Date.now().toString(36)}`,
      adapterId: this.id,
      adapterLabel: this.label,
      source: request.source,
      dest: request.dest,
      amountIn: request.amountIn,
      amountOut,
      minAmountOut,
      priceImpactPct,
      slippagePct: request.slippagePct,
      gasEstimate,
      gasCostUsd: gasEstimate * nominalGasPriceGwei * 1e-9 * nativePriceUsd,
      route: await this.getRoutes(request),
      warnings: [],
      createdAt: Date.now(),
      simulated: true,
    };
  }

  async estimateGas(quote: Quote): Promise<number> {
    return quote.gasEstimate;
  }

  async buildTransaction(quote: Quote, taker: string): Promise<TxRequest> {
    if (!taker) throw new QuoteError('NO_TAKER', 'A wallet is required to build a transaction');
    // The demo adapter emits router-shaped calldata so the confirmation screen
    // shows a real target and payload rather than an empty stub.
    const data =
      '0x38ed1739' + // swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
      toBigHex(toBaseUnits(quote.amountIn, quote.source.decimals)) +
      toBigHex(toBaseUnits(quote.minAmountOut, quote.dest.decimals));
    return {
      to: this.config.router,
      from: taker,
      data,
      value: quote.source.address === 'native' ? toBaseUnits(quote.amountIn, 18) : '0',
      chainId: quote.source.chainId,
      summary: `Swap ${quote.amountIn} ${quote.source.symbol} → ${quote.dest.symbol} via ${this.label}`,
    };
  }

  buildApproval(quote: Quote, taker: string): TxRequest {
    return {
      to: String(quote.source.address),
      from: taker,
      data: encodeApprove(this.config.router, BigInt(toBaseUnits(quote.amountIn, quote.source.decimals))),
      value: '0',
      chainId: quote.source.chainId,
      summary: `Approve ${quote.source.symbol} for ${this.label}`,
    };
  }
}

function toBigHex(value: string): string {
  return BigInt(value).toString(16).padStart(64, '0');
}
