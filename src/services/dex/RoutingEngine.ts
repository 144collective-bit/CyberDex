import type { Quote, QuoteWarning, TokenBalance } from '../../core/types';
import type { DexAdapter, QuoteRequest } from './DexAdapter';

export interface RoutingResult {
  /** Best quote by output, after warnings are attached. */
  best: Quote | null;
  /** Every venue that answered, best first. */
  quotes: Quote[];
  /** Venues that failed, with the reason, so the UI can be specific. */
  failures: { adapterId: string; label: string; reason: string }[];
}

export interface RiskContext {
  /** Balance of the source token, for insufficient-balance detection. */
  sourceBalance?: TokenBalance | null;
  /** Native balance, for gas checks. */
  nativeBalanceUsd?: number;
  simulationFailed?: boolean;
  needsApproval?: boolean;
  supportedChain?: boolean;
}

export const RISK_THRESHOLDS = {
  highPriceImpactPct: 3,
  severePriceImpactPct: 10,
  lowLiquidityImpactPct: 6,
  extremeSlippagePct: 5,
};

/**
 * Fans a quote request out across adapters and ranks the answers.
 *
 * The UI asks the engine, never a specific protocol — adding a venue is
 * registering one more adapter here.
 */
export class RoutingEngine {
  private adapters: DexAdapter[] = [];

  register(adapter: DexAdapter): void {
    if (this.adapters.some((a) => a.id === adapter.id)) return;
    this.adapters.push(adapter);
  }

  list(chainId?: number): DexAdapter[] {
    return chainId === undefined
      ? [...this.adapters]
      : this.adapters.filter((a) => a.chainIds.includes(chainId));
  }

  get(adapterId: string): DexAdapter | undefined {
    return this.adapters.find((a) => a.id === adapterId);
  }

  async quoteAll(request: QuoteRequest, risk: RiskContext = {}): Promise<RoutingResult> {
    const candidates = this.list(request.chainId);
    if (!candidates.length) {
      return {
        best: null,
        quotes: [],
        failures: [{ adapterId: 'none', label: 'ROUTER', reason: `No venue serves chain ${request.chainId}` }],
      };
    }

    const settled = await Promise.allSettled(candidates.map((adapter) => adapter.getQuote(request)));
    const quotes: Quote[] = [];
    const failures: RoutingResult['failures'] = [];

    settled.forEach((result, index) => {
      const adapter = candidates[index]!;
      if (result.status === 'fulfilled') {
        quotes.push({ ...result.value, warnings: assessQuote(result.value, risk) });
      } else {
        failures.push({
          adapterId: adapter.id,
          label: adapter.label,
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });

    quotes.sort((a, b) => b.amountOut - a.amountOut);
    return { best: quotes[0] ?? null, quotes, failures };
  }

  async quoteBest(request: QuoteRequest, risk: RiskContext = {}): Promise<Quote | null> {
    return (await this.quoteAll(request, risk)).best;
  }
}

/** Trade-safety assessment. Pure, so it is directly testable. */
export function assessQuote(quote: Quote, risk: RiskContext = {}): QuoteWarning[] {
  const warnings: QuoteWarning[] = [];

  if (quote.priceImpactPct >= RISK_THRESHOLDS.severePriceImpactPct) {
    warnings.push({
      code: 'HIGH_PRICE_IMPACT',
      severity: 'error',
      message: `Price impact ${quote.priceImpactPct.toFixed(2)}% — you would lose a large share of this trade.`,
    });
  } else if (quote.priceImpactPct >= RISK_THRESHOLDS.highPriceImpactPct) {
    warnings.push({
      code: 'HIGH_PRICE_IMPACT',
      severity: 'warning',
      message: `Price impact ${quote.priceImpactPct.toFixed(2)}% is above the ${RISK_THRESHOLDS.highPriceImpactPct}% comfort threshold.`,
    });
  }

  if (quote.priceImpactPct >= RISK_THRESHOLDS.lowLiquidityImpactPct) {
    warnings.push({
      code: 'LOW_LIQUIDITY',
      severity: 'warning',
      message: 'Trade size is large relative to available liquidity on this route.',
    });
  }

  if (quote.slippagePct >= RISK_THRESHOLDS.extremeSlippagePct) {
    warnings.push({
      code: 'EXTREME_SLIPPAGE',
      severity: 'warning',
      message: `Slippage tolerance ${quote.slippagePct}% allows a materially worse fill.`,
    });
  }

  if (quote.source.verified === false || quote.dest.verified === false) {
    warnings.push({
      code: 'UNVERIFIED_TOKEN',
      severity: 'warning',
      message: 'One of these tokens is unverified. Check the contract address before trading.',
    });
  }

  if (risk.supportedChain === false) {
    warnings.push({
      code: 'UNSUPPORTED_NETWORK',
      severity: 'error',
      message: 'Your wallet is on a network this route does not support.',
    });
  }

  if (risk.sourceBalance && risk.sourceBalance.amount < quote.amountIn) {
    warnings.push({
      code: 'INSUFFICIENT_BALANCE',
      severity: 'error',
      message: `Balance ${risk.sourceBalance.amount.toLocaleString()} ${quote.source.symbol} is below the trade amount.`,
    });
  }

  if (risk.nativeBalanceUsd !== undefined && risk.nativeBalanceUsd < quote.gasCostUsd) {
    warnings.push({
      code: 'INSUFFICIENT_GAS',
      severity: 'error',
      message: 'Native balance will not cover the estimated network fee.',
    });
  }

  if (risk.needsApproval) {
    warnings.push({
      code: 'APPROVAL_REQUIRED',
      severity: 'info',
      message: `${quote.source.symbol} needs a one-time approval before this swap can execute.`,
    });
  }

  if (risk.simulationFailed) {
    warnings.push({
      code: 'SIMULATION_FAILED',
      severity: 'error',
      message: 'Simulation failed — this transaction is likely to revert.',
    });
  }

  return warnings;
}

export function blockingWarnings(warnings: QuoteWarning[]): QuoteWarning[] {
  return warnings.filter((w) => w.severity === 'error');
}
