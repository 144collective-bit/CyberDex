import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events/bus';
import { WorkspaceStore } from '../core/deck/store';
import { createDeck } from '../core/deck/deckReducer';
import { ModuleRuntime } from '../core/modules/runtime';
import { resolveInputs } from '../core/graph/linkGraph';
import { MemoryAdapter } from '../core/storage/MemoryAdapter';
import type { PairRef, WalletRecord } from '../core/types';
import { DemoChainProvider } from '../services/chain/DemoChainProvider';
import { DemoDexAdapter } from '../services/dex/adapters/DemoDexAdapter';
import { RoutingEngine } from '../services/dex/RoutingEngine';
import { DemoMarketDataProvider } from '../services/market/DemoMarketDataProvider';
import { findToken, makePair } from '../services/market/tokens';
import { ExecutionService } from '../services/execution/ExecutionService';
import { TransactionLedger } from '../services/execution/TransactionLedger';
import { WalletService } from '../services/wallet/WalletService';
import { MODULE_TYPES } from '../modules/definitions';

/**
 * The MVP proof from the product spec, executed against the real architecture:
 * add modules → select a pair → wire pair and wallet into the swap → resolve
 * inputs through the graph → quote → review → explicitly confirm → transaction
 * lands in the feed.
 */
describe('MVP module connection workflow', () => {
  it('drives a swap entirely through modules, links and the event bus', async () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    const storage = new MemoryAdapter();
    const runtime = new ModuleRuntime();
    const market = new DemoMarketDataProvider(0);

    const deck = createDeck('MVP DECK');
    const store = new WorkspaceStore({ decks: [deck], activeDeckId: deck.id, lastError: null }, storage, bus, 0);
    const deckId = deck.id;

    // 1–3. The user adds Wallet, Pair Selector, Chart and Swap.
    for (const moduleType of [
      MODULE_TYPES.wallet,
      MODULE_TYPES.pairSelector,
      MODULE_TYPES.chart,
      MODULE_TYPES.swap,
      MODULE_TYPES.transactions,
    ]) {
      store.dispatch({ type: 'MODULE/ADD', deckId, moduleType });
    }
    const [walletModule, pairModule, chartModule, swapModule, feedModule] = store.getActiveDeck()!.modules;
    expect(store.getActiveDeck()!.modules).toHaveLength(5);

    // 8–11. The user wires pair → chart, pair → swap, wallet → swap, wallet → feed.
    const linkEvents: string[] = [];
    bus.on('LINK_CREATED', (payload) => linkEvents.push(payload.connectionId));
    const link = (source: string, portId: string, target: string, input: string) =>
      store.dispatch({
        type: 'LINK/CONNECT',
        deckId,
        source: { moduleId: source, portId },
        target: { moduleId: target, portId: input },
      });
    link(pairModule!.id, 'pair', chartModule!.id, 'pair');
    link(pairModule!.id, 'pair', swapModule!.id, 'pair');
    link(walletModule!.id, 'wallet', swapModule!.id, 'wallet');
    link(walletModule!.id, 'wallet', feedModule!.id, 'wallet');
    expect(store.getActiveDeck()!.connections).toHaveLength(4);
    expect(linkEvents).toHaveLength(4);

    // 2. The user loads the demo vault; the wallet module publishes it.
    const wallets = new WalletService(storage, bus, null);
    const walletRecord: WalletRecord = wallets.addDemoWallet();
    runtime.setOutputs(walletModule!.id, { wallet: walletRecord, address: walletRecord.address });

    // 4–6. The user selects HEX and PLS; the pair module publishes HEX/PLS.
    const hex = findToken(369, 'HEX')!;
    const pls = findToken(369, 'PLS')!;
    const pair: PairRef = makePair(hex, pls);
    const pairEvents: PairRef[] = [];
    bus.on('PAIR_CHANGED', (payload) => pairEvents.push(payload.pair));
    runtime.setOutputs(pairModule!.id, { pair, tokenA: hex, tokenB: pls });
    bus.emit('PAIR_CHANGED', { pair }, pairModule!.id);
    expect(pairEvents[0]?.label).toBe('HEX/PLS');

    // 12. Chart and Swap receive the pair (and the swap the wallet) with no
    //     direct coupling between the modules.
    const read = (moduleId: string, portId: string) => runtime.getOutput(moduleId, portId);
    const chartInputs = resolveInputs(store.getActiveDeck()!, chartModule!.id, read);
    const swapInputs = resolveInputs(store.getActiveDeck()!, swapModule!.id, read);
    expect((chartInputs.pair as PairRef).label).toBe('HEX/PLS');
    expect((swapInputs.pair as PairRef).label).toBe('HEX/PLS');
    expect((swapInputs.wallet as WalletRecord).id).toBe(walletRecord.id);

    // 13–14. The user enters an amount and the swap module fetches a quote.
    const routing = new RoutingEngine();
    routing.register(
      new DemoDexAdapter(
        { id: 'demo', label: 'DEMO DEX', chainIds: [369], feePct: 0.003, liquidityShare: 0.7, router: '0xrouter' },
        market,
      ),
    );
    const result = await routing.quoteAll({
      source: (swapInputs.pair as PairRef).base,
      dest: (swapInputs.pair as PairRef).quote,
      amountIn: 10_000,
      slippagePct: 0.5,
      chainId: 369,
      taker: String(walletRecord.address),
    });
    const quote = result.best!;
    expect(quote.amountOut).toBeGreaterThan(0);
    runtime.setOutputs(swapModule!.id, { quote });

    // 15–16. Review, then explicit confirmation. Execution refuses either step
    //        being skipped (covered in execution.test.ts).
    const chain = new DemoChainProvider(369, 10);
    const ledger = new TransactionLedger(storage, bus);
    const execution = new ExecutionService(ledger, bus);
    const adapter = routing.get('demo')!;
    const prepared = await execution.prepare(quote, walletRecord, adapter, chain);
    expect(prepared.request.summary).toMatch(/Swap 10000 HEX/);

    const approval = await execution.approve(prepared, chain);
    expect(approval.type).toBe('APPROVAL');
    const tx = await execution.execute({ ...prepared, needsApproval: false }, chain, true);

    // 17–18. Status is reported and the trade appears in the feed.
    expect(tx.status).toBe('PENDING');
    await vi.advanceTimersByTimeAsync(3000);
    const feed = ledger.list({ wallet: String(walletRecord.address) });
    expect(feed).toHaveLength(2);
    expect(feed.find((record) => record.type === 'SWAP')?.status).toBe('CONFIRMED');
    expect(feed.every((record) => record.simulated)).toBe(true);

    // The deck that produced all of this survives a reload.
    await store.flush();
    const reloaded = new WorkspaceStore(
      { decks: [createDeck('EMPTY')], activeDeckId: 'x', lastError: null },
      storage,
      bus,
      0,
    );
    expect(await reloaded.hydrate()).toBe(true);
    expect(reloaded.getActiveDeck()!.modules).toHaveLength(5);
    expect(reloaded.getActiveDeck()!.connections).toHaveLength(4);
    vi.useRealTimers();
  });
});
