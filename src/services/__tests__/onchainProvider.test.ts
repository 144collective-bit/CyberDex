import { describe, expect, it, vi } from 'vitest';
import { JsonRpcClient } from '../chain/JsonRpcClient';
import { PulseChainMarketProvider } from '../market/onchain/PulseChainMarketProvider';
import { PulseXOnChainAdapter } from '../dex/adapters/PulseXOnChainAdapter';
import { getChainMarketConfig } from '../chain/chainConfig';
import { findToken, makePair } from '../market/tokens';

const config = getChainMarketConfig(369)!;
const HEX = findToken(369, 'HEX')!;
const PLS = findToken(369, 'PLS')!;
const DAI = findToken(369, 'DAI')!;

const word = (value: bigint | number) => BigInt(value).toString(16).padStart(64, '0');
const addressWord = (address: string) => address.toLowerCase().replace(/^0x/, '').padStart(64, '0');

const PAIR_HEX_WPLS = '0x1111111111111111111111111111111111111111';
const PAIR_WPLS_DAI = '0x2222222222222222222222222222222222222222';
const PAIR_HEX_DAI = '0x3333333333333333333333333333333333333333';

/**
 * A stand-in PulseChain node: answers getPair, token0/token1 and getReserves
 * for a small fixed set of pools, so the provider's routing and maths can be
 * exercised without a live RPC.
 */
function fakeNode(options: { reserves?: Record<string, [bigint, bigint]>; blockNumber?: number } = {}) {
  const reserves: Record<string, [bigint, bigint]> = options.reserves ?? {
    // 1,000,000 HEX (8dp) ↔ 100,000,000 WPLS (18dp) → 100 WPLS per HEX
    [PAIR_HEX_WPLS]: [1_000_000n * 10n ** 8n, 100_000_000n * 10n ** 18n],
    // 10,000,000 WPLS ↔ 340 DAI → $0.000034 per WPLS
    [PAIR_WPLS_DAI]: [10_000_000n * 10n ** 18n, 340n * 10n ** 18n],
  };
  const token0: Record<string, string> = {
    [PAIR_HEX_WPLS]: HEX.address,
    [PAIR_WPLS_DAI]: config.wrappedNative,
    [PAIR_HEX_DAI]: HEX.address,
  };
  const token1: Record<string, string> = {
    [PAIR_HEX_WPLS]: config.wrappedNative,
    [PAIR_WPLS_DAI]: config.stables[0]!.address,
    [PAIR_HEX_DAI]: config.stables[0]!.address,
  };

  const calls: string[] = [];
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body));
    const requests = Array.isArray(payload) ? payload : [payload];
    const answers = requests.map((request: { id: number; method: string; params?: unknown[] }) => {
      calls.push(request.method);
      if (request.method === 'eth_blockNumber') {
        return { jsonrpc: '2.0', id: request.id, result: `0x${(options.blockNumber ?? 21_000_000).toString(16)}` };
      }
      const call = (request.params?.[0] ?? {}) as { to: string; data: string };
      const to = call.to?.toLowerCase() ?? '';
      const data = call.data ?? '';

      // getPair(tokenA, tokenB)
      if (data.startsWith('0xe6a43905')) {
        const a = `0x${data.slice(10 + 24, 10 + 64)}`.toLowerCase();
        const b = `0x${data.slice(10 + 64 + 24, 10 + 128)}`.toLowerCase();
        const set = new Set([a, b]);
        const isPair = (x: string, y: string) => set.has(x.toLowerCase()) && set.has(y.toLowerCase());
        let pair = '0x' + '0'.repeat(40);
        if (isPair(HEX.address, config.wrappedNative)) pair = PAIR_HEX_WPLS;
        else if (isPair(config.wrappedNative, config.stables[0]!.address)) pair = PAIR_WPLS_DAI;
        // Only the first factory knows these pairs.
        const fromFirstFactory = to === config.factories[0]!.address.toLowerCase();
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: `0x${addressWord(fromFirstFactory ? pair : '0x' + '0'.repeat(40))}`,
        };
      }
      if (data === '0x0dfe1681') {
        return { jsonrpc: '2.0', id: request.id, result: `0x${addressWord(token0[call.to] ?? '0x0')}` };
      }
      if (data === '0xd21220a7') {
        return { jsonrpc: '2.0', id: request.id, result: `0x${addressWord(token1[call.to] ?? '0x0')}` };
      }
      if (data === '0x0902f1ac') {
        const entry = reserves[call.to];
        if (!entry) return { jsonrpc: '2.0', id: request.id, result: `0x${word(0)}${word(0)}${word(0)}` };
        return { jsonrpc: '2.0', id: request.id, result: `0x${word(entry[0])}${word(entry[1])}${word(1700000000)}` };
      }
      // getAmountsOut → [in, out]
      if (data.startsWith('0xd06ca61f')) {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: `0x${word(32)}${word(2)}${word(1000n * 10n ** 8n)}${word(99_700n * 10n ** 18n)}`,
        };
      }
      return { jsonrpc: '2.0', id: request.id, result: '0x' };
    });
    return new Response(JSON.stringify(Array.isArray(payload) ? answers : answers[0]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const rpc = new JsonRpcClient({ endpoints: ['https://fake.rpc'], fetchImpl: fetchImpl as unknown as typeof fetch });
  return { rpc, fetchImpl, calls };
}

describe('PulseChainMarketProvider', () => {
  it('prices a token through the native hub and a stable pool', async () => {
    const { rpc } = fakeNode();
    const provider = new PulseChainMarketProvider({ rpc });
    const [market] = await provider.getMarkets([HEX]);
    // 100 WPLS per HEX × $0.000034 per WPLS = $0.0034
    expect(market!.priceUsd).toBeCloseTo(0.0034, 9);
    expect(market!.simulated).toBe(false);
    expect(market!.liquidityUsd).toBeGreaterThan(0);
  });

  it('prices the native token itself from its stable pool', async () => {
    const { rpc } = fakeNode();
    const provider = new PulseChainMarketProvider({ rpc });
    const [market] = await provider.getMarkets([PLS]);
    expect(market!.priceUsd).toBeCloseTo(0.000034, 12);
  });

  it('pins every read in a refresh to one block', async () => {
    const { rpc, fetchImpl } = fakeNode({ blockNumber: 21_222_333 });
    const provider = new PulseChainMarketProvider({ rpc });
    await provider.getMarkets([HEX, PLS]);

    const blockTags = new Set<string>();
    for (const call of fetchImpl.mock.calls) {
      const payload = JSON.parse(String(call[1]!.body));
      for (const request of Array.isArray(payload) ? payload : [payload]) {
        if (request.method === 'eth_call') blockTags.add(String(request.params[1]));
      }
    }
    expect(blockTags.size).toBe(1);
    expect([...blockTags][0]).toBe(`0x${(21_222_333).toString(16)}`);
  });

  it('caches pair lookups instead of resolving them every refresh', async () => {
    const { rpc, fetchImpl } = fakeNode();
    const provider = new PulseChainMarketProvider({ rpc });
    await provider.getMarkets([HEX]);
    const afterFirst = fetchImpl.mock.calls.length;
    await provider.getMarkets([HEX]);
    const secondPass = fetchImpl.mock.calls.length - afterFirst;
    expect(secondPass).toBeLessThan(afterFirst);
  });

  it('reports a zero price rather than guessing when no pool exists', async () => {
    const { rpc } = fakeNode({ reserves: {} });
    const provider = new PulseChainMarketProvider({ rpc });
    const [market] = await provider.getMarkets([DAI]);
    expect(market!.priceUsd).toBe(0);
  });

  it('returns no candles, because reserves carry no history', async () => {
    const { rpc } = fakeNode();
    const provider = new PulseChainMarketProvider({ rpc });
    await expect(provider.getOHLC(makePair(HEX, PLS), '1h')).resolves.toEqual([]);
    await expect(provider.getWhaleMovements()).resolves.toEqual([]);
  });

  it('reports health from endpoint state', async () => {
    const { rpc } = fakeNode();
    const provider = new PulseChainMarketProvider({ rpc });
    await expect(provider.health()).resolves.toBe('online');
  });

  it('is offline when the node cannot be reached', async () => {
    const rpc = new JsonRpcClient({
      endpoints: ['https://dead.rpc'],
      fetchImpl: (async () => {
        throw new Error('down');
      }) as unknown as typeof fetch,
    });
    const provider = new PulseChainMarketProvider({ rpc });
    await expect(provider.health()).resolves.toBe('offline');
  });
});

describe('PulseXOnChainAdapter', () => {
  it('quotes from the router and derives impact from pool reserves', async () => {
    const { rpc } = fakeNode();
    const adapter = new PulseXOnChainAdapter({ rpc });
    const quote = await adapter.getQuote({
      source: HEX,
      dest: PLS,
      amountIn: 1000,
      slippagePct: 0.5,
      chainId: 369,
    });
    expect(quote.amountOut).toBeCloseTo(99_700, 6);
    expect(quote.minAmountOut).toBeCloseTo(99_700 * 0.995, 6);
    expect(quote.priceImpactPct).toBeGreaterThan(0);
    expect(quote.simulated).toBe(false);
    expect(quote.adapterId).toBe('pulsex-onchain');
  });

  it('rejects a zero amount and a same-token swap', async () => {
    const { rpc } = fakeNode();
    const adapter = new PulseXOnChainAdapter({ rpc });
    await expect(
      adapter.getQuote({ source: HEX, dest: PLS, amountIn: 0, slippagePct: 0.5, chainId: 369 }),
    ).rejects.toThrow(/greater than zero/);
    await expect(
      adapter.getQuote({ source: HEX, dest: HEX, amountIn: 10, slippagePct: 0.5, chainId: 369 }),
    ).rejects.toThrow(/same token/i);
  });

  it('refuses a chain it is not configured for', async () => {
    const { rpc } = fakeNode();
    const adapter = new PulseXOnChainAdapter({ rpc });
    await expect(
      adapter.getQuote({ source: HEX, dest: PLS, amountIn: 1, slippagePct: 0.5, chainId: 1 }),
    ).rejects.toThrow(/does not serve chain/);
  });

  it('builds router calldata with the path, recipient and deadline', async () => {
    const { rpc } = fakeNode();
    const adapter = new PulseXOnChainAdapter({ rpc });
    const quote = await adapter.getQuote({
      source: HEX,
      dest: PLS,
      amountIn: 1000,
      slippagePct: 0.5,
      chainId: 369,
    });
    const taker = '0x82Ae4bC0f4A1b9E7B85e0Fa9D1A3C7f2E5a83791';
    const tx = await adapter.buildTransaction(quote, taker);
    expect(tx.to).toBe(config.router.address);
    expect(tx.data?.startsWith('0x38ed1739')).toBe(true);
    expect(tx.data?.toLowerCase()).toContain(taker.slice(2).toLowerCase());
    expect(tx.summary).toContain('HEX → PLS');
  });

  it('approves only the router, for the exact amount', async () => {
    const { rpc } = fakeNode();
    const adapter = new PulseXOnChainAdapter({ rpc });
    const quote = await adapter.getQuote({
      source: HEX,
      dest: PLS,
      amountIn: 1000,
      slippagePct: 0.5,
      chainId: 369,
    });
    const approval = adapter.buildApproval(quote, '0x82Ae4bC0f4A1b9E7B85e0Fa9D1A3C7f2E5a83791');
    expect(approval.to).toBe(HEX.address);
    expect(approval.data?.startsWith('0x095ea7b3')).toBe(true);
    expect(approval.data?.toLowerCase()).toContain(config.router.address.slice(2).toLowerCase());
  });
});
