import { describe, expect, it } from 'vitest';
import { RoutingEngine, assessQuote, blockingWarnings } from '../dex/RoutingEngine';
import { DemoDexAdapter } from '../dex/adapters/DemoDexAdapter';
import { DemoMarketDataProvider } from '../market/DemoMarketDataProvider';
import { findToken } from '../market/tokens';
import type { Quote } from '../../core/types';

const market = new DemoMarketDataProvider(0);
const hex = findToken(369, 'HEX')!;
const pls = findToken(369, 'PLS')!;

function engine(): RoutingEngine {
  const routing = new RoutingEngine();
  routing.register(
    new DemoDexAdapter(
      { id: 'deep', label: 'DEEP', chainIds: [369], feePct: 0.001, liquidityShare: 0.9, router: '0xdeep' },
      market,
    ),
  );
  routing.register(
    new DemoDexAdapter(
      { id: 'thin', label: 'THIN', chainIds: [369], feePct: 0.01, liquidityShare: 0.05, router: '0xthin' },
      market,
    ),
  );
  return routing;
}

describe('RoutingEngine', () => {
  it('quotes every venue and ranks the best output first', async () => {
    const result = await engine().quoteAll({
      source: hex,
      dest: pls,
      amountIn: 1000,
      slippagePct: 0.5,
      chainId: 369,
    });
    expect(result.quotes).toHaveLength(2);
    expect(result.best?.adapterId).toBe('deep');
    expect(result.quotes[0]!.amountOut).toBeGreaterThanOrEqual(result.quotes[1]!.amountOut);
  });

  it('reports venues that cannot serve the chain rather than throwing', async () => {
    const result = await engine().quoteAll({
      source: findToken(1, 'HEX')!,
      dest: findToken(1, 'USDC')!,
      amountIn: 10,
      slippagePct: 0.5,
      chainId: 1,
    });
    expect(result.best).toBeNull();
    expect(result.failures[0]?.reason).toMatch(/No venue serves chain 1/);
  });

  it('rejects a zero amount and a same-token swap', async () => {
    const routing = engine();
    const zero = await routing.quoteAll({ source: hex, dest: pls, amountIn: 0, slippagePct: 0.5, chainId: 369 });
    expect(zero.best).toBeNull();
    const same = await routing.quoteAll({ source: hex, dest: hex, amountIn: 10, slippagePct: 0.5, chainId: 369 });
    expect(same.best).toBeNull();
    expect(same.failures[0]?.reason).toMatch(/same token/i);
  });

  it('grows price impact with trade size on the same venue', async () => {
    const routing = engine();
    const small = await routing.quoteBest({ source: hex, dest: pls, amountIn: 100, slippagePct: 0.5, chainId: 369 });
    const large = await routing.quoteBest({
      source: hex,
      dest: pls,
      amountIn: 100_000_000,
      slippagePct: 0.5,
      chainId: 369,
    });
    expect(large!.priceImpactPct).toBeGreaterThan(small!.priceImpactPct);
  });

  it('applies slippage to the minimum received', async () => {
    const quote = await engine().quoteBest({
      source: hex,
      dest: pls,
      amountIn: 1000,
      slippagePct: 2,
      chainId: 369,
    });
    expect(quote!.minAmountOut).toBeCloseTo(quote!.amountOut * 0.98, 6);
  });
});

describe('trade safety assessment', () => {
  const base: Quote = {
    id: 'q',
    adapterId: 'x',
    adapterLabel: 'X',
    source: hex,
    dest: pls,
    amountIn: 100,
    amountOut: 100,
    minAmountOut: 99,
    priceImpactPct: 0.1,
    slippagePct: 0.5,
    gasEstimate: 180000,
    gasCostUsd: 0.02,
    route: [],
    warnings: [],
    createdAt: Date.now(),
    simulated: true,
  };

  it('stays quiet on a clean quote', () => {
    expect(assessQuote(base)).toHaveLength(0);
  });

  it('escalates price impact from warning to error', () => {
    const warned = assessQuote({ ...base, priceImpactPct: 4 });
    expect(warned.find((w) => w.code === 'HIGH_PRICE_IMPACT')?.severity).toBe('warning');
    const errored = assessQuote({ ...base, priceImpactPct: 12 });
    expect(errored.find((w) => w.code === 'HIGH_PRICE_IMPACT')?.severity).toBe('error');
  });

  it('flags insufficient balance as blocking', () => {
    const warnings = assessQuote(base, {
      sourceBalance: { token: hex, raw: '0', amount: 10, valueUsd: 0 },
    });
    expect(blockingWarnings(warnings).some((w) => w.code === 'INSUFFICIENT_BALANCE')).toBe(true);
  });

  it('flags gas shortfall, unsupported network and failed simulation', () => {
    const warnings = assessQuote(base, {
      nativeBalanceUsd: 0,
      supportedChain: false,
      simulationFailed: true,
    });
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain('INSUFFICIENT_GAS');
    expect(codes).toContain('UNSUPPORTED_NETWORK');
    expect(codes).toContain('SIMULATION_FAILED');
  });

  it('treats a needed approval as information, not a blocker', () => {
    const warnings = assessQuote(base, { needsApproval: true });
    expect(warnings.find((w) => w.code === 'APPROVAL_REQUIRED')?.severity).toBe('info');
    expect(blockingWarnings(warnings)).toHaveLength(0);
  });

  it('warns on an unverified token', () => {
    const warnings = assessQuote({ ...base, dest: { ...pls, verified: false } });
    expect(warnings.some((w) => w.code === 'UNVERIFIED_TOKEN')).toBe(true);
  });
});
