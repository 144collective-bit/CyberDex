import { describe, expect, it, beforeEach, vi } from 'vitest';
import { EventBus } from '../../core/events/bus';
import { MemoryAdapter } from '../../core/storage/MemoryAdapter';
import type { WalletRecord } from '../../core/types';
import { DemoChainProvider } from '../chain/DemoChainProvider';
import { DemoDexAdapter } from '../dex/adapters/DemoDexAdapter';
import { DemoMarketDataProvider } from '../market/DemoMarketDataProvider';
import { findToken } from '../market/tokens';
import { ExecutionService, ExecutionError } from '../execution/ExecutionService';
import { TransactionLedger } from '../execution/TransactionLedger';
import { WalletService } from '../wallet/WalletService';

const market = new DemoMarketDataProvider(0);
const hex = findToken(369, 'HEX')!;
const pls = findToken(369, 'PLS')!;

const adapter = new DemoDexAdapter(
  { id: 'demo', label: 'DEMO DEX', chainIds: [369], feePct: 0.003, liquidityShare: 0.6, router: '0xrouter' },
  market,
);

const executionWallet: WalletRecord = {
  id: 'w1',
  address: '0x1111111111111111111111111111111111111111',
  label: 'DEMO VAULT',
  chainId: 369,
  kind: 'demo',
  watchOnly: false,
  addedAt: Date.now(),
};

const watchWallet: WalletRecord = { ...executionWallet, id: 'w2', kind: 'watch', watchOnly: true, label: 'WATCH' };

async function quoteHexToPls(amountIn = 1000) {
  return adapter.getQuote({ source: hex, dest: pls, amountIn, slippagePct: 0.5, chainId: 369 });
}

describe('ExecutionService', () => {
  let bus: EventBus;
  let ledger: TransactionLedger;
  let execution: ExecutionService;
  let chain: DemoChainProvider;

  beforeEach(() => {
    bus = new EventBus();
    ledger = new TransactionLedger(new MemoryAdapter(), bus);
    execution = new ExecutionService(ledger, bus);
    chain = new DemoChainProvider(369, 10);
  });

  it('refuses to prepare a trade for a watch wallet', async () => {
    const quote = await quoteHexToPls();
    await expect(execution.prepare(quote, watchWallet, adapter, chain)).rejects.toBeInstanceOf(ExecutionError);
  });

  it('refuses to prepare without a wallet', async () => {
    const quote = await quoteHexToPls();
    await expect(execution.prepare(quote, null, adapter, chain)).rejects.toThrow(/Connect a wallet/);
  });

  it('detects that an ERC-20 needs approval before it can swap', async () => {
    const quote = await quoteHexToPls();
    const trade = await execution.prepare(quote, executionWallet, adapter, chain);
    expect(trade.needsApproval).toBe(true);
    expect(trade.approval).not.toBeNull();
    expect(trade.request.to).toBe('0xrouter');
    expect(trade.request.data?.startsWith('0x38ed1739')).toBe(true);
  });

  it('will not execute while an approval is outstanding', async () => {
    const quote = await quoteHexToPls();
    const trade = await execution.prepare(quote, executionWallet, adapter, chain);
    await expect(execution.execute(trade, chain, true)).rejects.toThrow(/approval is still required/i);
  });

  it('will not execute without explicit confirmation', async () => {
    const quote = await quoteHexToPls();
    const trade = await execution.prepare(quote, executionWallet, adapter, chain);
    await expect(execution.execute({ ...trade, needsApproval: false }, chain, false)).rejects.toThrow(
      /not explicitly confirmed/i,
    );
  });

  it('will not execute a trade carrying blocking warnings', async () => {
    const quote = await quoteHexToPls();
    const trade = await execution.prepare(quote, executionWallet, adapter, chain);
    await expect(
      execution.execute({ ...trade, needsApproval: false, blockers: ['Insufficient balance'] }, chain, true),
    ).rejects.toThrow(/Insufficient balance/);
  });

  it('records a confirmed swap in the ledger, flagged as simulated', async () => {
    vi.useFakeTimers();
    const quote = await quoteHexToPls();
    const prepared = await execution.prepare(quote, executionWallet, adapter, chain);
    const submitted = vi.fn();
    const confirmed = vi.fn();
    bus.on('TRANSACTION_SUBMITTED', submitted);
    bus.on('TRANSACTION_CONFIRMED', confirmed);

    const record = await execution.execute({ ...prepared, needsApproval: false }, chain, true);
    expect(record.simulated).toBe(true);
    expect(record.hash?.startsWith('sim:')).toBe(true);
    expect(record.status).toBe('PENDING');
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(ledger.getState()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(ledger.getState()[0]?.status).toBe('CONFIRMED');
    expect(confirmed).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('native swaps skip approval entirely', async () => {
    const quote = await adapter.getQuote({
      source: pls,
      dest: hex,
      amountIn: 1000,
      slippagePct: 0.5,
      chainId: 369,
    });
    const trade = await execution.prepare(quote, executionWallet, adapter, chain);
    expect(trade.needsApproval).toBe(false);
    expect(trade.simulation.ok).toBe(true);
  });
});

describe('WalletService', () => {
  it('marks watch wallets read-only and refuses signing downstream', () => {
    const wallets = new WalletService(new MemoryAdapter(), new EventBus(), null);
    const watch = wallets.addWatchWallet('0x2222222222222222222222222222222222222222', 'WHALE');
    expect(watch.watchOnly).toBe(true);
    expect(wallets.canSign(watch)).toBe(false);
    const demo = wallets.addDemoWallet();
    expect(wallets.canSign(demo)).toBe(true);
  });

  it('rejects an invalid watch address', () => {
    const wallets = new WalletService(new MemoryAdapter(), new EventBus(), null);
    expect(() => wallets.addWatchWallet('not-an-address')).toThrow(/valid EVM address/);
  });

  it('emits wallet and network events as state changes', () => {
    const bus = new EventBus();
    const wallets = new WalletService(new MemoryAdapter(), bus, null);
    const changed = vi.fn();
    const network = vi.fn();
    bus.on('WALLET_CHANGED', changed);
    bus.on('NETWORK_CHANGED', network);
    wallets.addDemoWallet();
    wallets.setChain(1);
    expect(changed).toHaveBeenCalled();
    expect(network).toHaveBeenCalledWith({ chainId: 1 }, expect.anything());
  });

  it('persists non-injected wallets across a restart', async () => {
    const adapter = new MemoryAdapter();
    const first = new WalletService(adapter, new EventBus(), null);
    first.addWatchWallet('0x3333333333333333333333333333333333333333', 'DESK');
    const second = new WalletService(adapter, new EventBus(), null);
    await second.hydrate();
    expect(second.getState().wallets).toHaveLength(1);
    expect(second.getActiveWallet()?.label).toBe('DESK');
  });

  it('fails connect cleanly with no injected provider', async () => {
    const wallets = new WalletService(new MemoryAdapter(), new EventBus(), null);
    await expect(wallets.connectInjected()).rejects.toThrow(/No browser wallet/);
    expect(wallets.getState().error).toMatch(/No browser wallet/);
  });
});
