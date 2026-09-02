import type { EventBus } from '../../core/events/bus';
import type { Quote, TxRecord, WalletRecord } from '../../core/types';
import type { ChainProvider, TxRequest } from '../chain/ChainProvider';
import { fromBaseUnits, toBaseUnits } from '../chain/abi';
import type { DexAdapter } from '../dex/DexAdapter';
import { DemoDexAdapter } from '../dex/adapters/DemoDexAdapter';
import { blockingWarnings } from '../dex/RoutingEngine';
import type { TransactionLedger } from './TransactionLedger';

export interface PreparedTrade {
  quote: Quote;
  wallet: WalletRecord;
  adapter: DexAdapter;
  request: TxRequest;
  approval: TxRequest | null;
  needsApproval: boolean;
  allowance: bigint;
  simulation: { ok: boolean; reason?: string; gasUsed?: number };
  blockers: string[];
}

export class ExecutionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ExecutionError';
  }
}

/**
 * The only path from a quote to a signed transaction.
 *
 * Two guarantees enforced here, not in the UI:
 *  1. A watch-only wallet can never reach a signing call.
 *  2. `prepare()` must run before `execute()`, so the user always sees the
 *     resolved route, allowance and simulation before confirming.
 */
export class ExecutionService {
  private ledger: TransactionLedger;
  private bus: EventBus;

  constructor(ledger: TransactionLedger, bus: EventBus) {
    this.ledger = ledger;
    this.bus = bus;
  }

  async prepare(
    quote: Quote,
    wallet: WalletRecord | null,
    adapter: DexAdapter,
    chain: ChainProvider,
  ): Promise<PreparedTrade> {
    if (!wallet) throw new ExecutionError('NO_WALLET', 'Connect a wallet before reviewing a trade');
    if (wallet.watchOnly) {
      throw new ExecutionError('WATCH_ONLY', 'This is a watch wallet. It can analyse, but never sign.');
    }

    const spender = adapter.routerAddress(chain.chainId);
    const allowance =
      quote.source.address === 'native'
        ? 2n ** 255n
        : await chain.getAllowance(quote.source, wallet.address, spender);
    const required = BigInt(toBaseUnits(quote.amountIn, quote.source.decimals));
    const needsApproval = allowance < required;

    const request = await adapter.buildTransaction(quote, String(wallet.address));
    const approval =
      needsApproval && adapter instanceof DemoDexAdapter
        ? adapter.buildApproval(quote, String(wallet.address))
        : needsApproval
          ? {
              to: String(quote.source.address),
              from: String(wallet.address),
              data: undefined,
              value: '0',
              chainId: chain.chainId,
              summary: `Approve ${quote.source.symbol}`,
            }
          : null;

    // Simulate the swap itself; an unapproved token legitimately fails here, so
    // that case is reported as "approval first", not as a broken trade.
    const simulation = needsApproval
      ? { ok: true, reason: 'Simulation deferred until approval is granted' }
      : await chain.simulateTransaction(request);

    const blockers = blockingWarnings(quote.warnings).map((w) => w.message);
    if (!simulation.ok && simulation.reason) blockers.push(`Simulation failed: ${simulation.reason}`);
    if (wallet.chainId !== chain.chainId) {
      blockers.push(`Wallet is on chain ${wallet.chainId}, route is on chain ${chain.chainId}`);
    }

    this.bus.emit('TRADE_REVIEWED', { quote }, 'execution');
    return {
      quote,
      wallet,
      adapter,
      request,
      approval,
      needsApproval,
      allowance,
      simulation,
      blockers,
    };
  }

  /** Submit the approval. Separate call, separate user confirmation. */
  async approve(trade: PreparedTrade, chain: ChainProvider): Promise<TxRecord> {
    if (!trade.approval) throw new ExecutionError('NO_APPROVAL', 'This trade does not need an approval');
    this.assertSignable(trade.wallet);
    const record = await chain.sendTransaction(trade.approval);
    const stored = this.ledger.add({ ...record, type: 'APPROVAL' });
    this.track(stored, chain);
    return stored;
  }

  /**
   * Execute. Requires an explicit confirmation token from the review step so a
   * trade can never be submitted straight from a quote.
   */
  async execute(trade: PreparedTrade, chain: ChainProvider, confirmed: boolean): Promise<TxRecord> {
    if (!confirmed) throw new ExecutionError('NOT_CONFIRMED', 'Trade was not explicitly confirmed');
    this.assertSignable(trade.wallet);
    if (trade.needsApproval) {
      throw new ExecutionError('APPROVAL_REQUIRED', `${trade.quote.source.symbol} approval is still required`);
    }
    if (trade.blockers.length) {
      throw new ExecutionError('BLOCKED', trade.blockers[0]!);
    }

    this.bus.emit('TRADE_CREATED', { quote: trade.quote }, 'execution');
    try {
      const record = await chain.sendTransaction(trade.request);
      const stored = this.ledger.add({
        ...record,
        type: 'SWAP',
        summary: trade.request.summary,
        metadata: {
          ...record.metadata,
          amountIn: trade.quote.amountIn,
          amountOut: trade.quote.amountOut,
          minAmountOut: trade.quote.minAmountOut,
          source: trade.quote.source.symbol,
          dest: trade.quote.dest.symbol,
          route: trade.quote.route,
          adapter: trade.adapter.label,
        },
      });
      this.track(stored, chain);
      return stored;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const rejected = /user rejected|denied/i.test(message);
      const record = this.ledger.add({
        id: `fail_${Date.now().toString(36)}`,
        hash: null,
        wallet: trade.wallet.address,
        chainId: chain.chainId,
        type: 'SWAP',
        status: rejected ? 'REJECTED' : 'FAILED',
        timestamp: Date.now(),
        summary: trade.request.summary,
        simulated: chain.origin === 'demo',
        error: message,
      });
      this.ledger.setStatus(record.id, record.status, message);
      throw err;
    }
  }

  /**
   * Resolve once the ledger reports a terminal status for a transaction.
   * The swap flow uses this so an approval is actually on chain before the
   * allowance is re-read.
   */
  waitForSettlement(txId: string, timeoutMs = 60_000): Promise<TxRecord | null> {
    return new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        const record = this.ledger.getState().find((tx) => tx.id === txId);
        if (record && record.status !== 'PENDING') {
          resolve(record);
          return;
        }
        if (Date.now() - started > timeoutMs) {
          resolve(record ?? null);
          return;
        }
        setTimeout(check, 500);
      };
      check();
    });
  }

  private assertSignable(wallet: WalletRecord): void {
    if (wallet.watchOnly) {
      throw new ExecutionError('WATCH_ONLY', 'Watch wallets cannot sign transactions');
    }
  }

  /** Poll until the chain reports a terminal status. */
  private track(record: TxRecord, chain: ChainProvider): void {
    if (!record.hash) return;
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const latest = await chain.getTransaction(record.hash!);
        if (latest && latest.status !== 'PENDING') {
          this.ledger.setStatus(record.id, latest.status, latest.error);
          return;
        }
      } catch {
        /* keep polling — a missing receipt is normal while pending */
      }
      if (attempts < 40) setTimeout(poll, 1500);
      else this.ledger.update(record.id, { error: 'Timed out waiting for a receipt' });
    };
    setTimeout(poll, 1500);
  }
}

export function formatAllowance(allowance: bigint, decimals: number): string {
  if (allowance > 2n ** 200n) return 'UNLIMITED';
  return fromBaseUnits(allowance, decimals).toLocaleString(undefined, { maximumFractionDigits: 4 });
}
