import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import type { PairRef, Quote, TokenRef, TxRecord, WalletRecord } from '../../core/types';
import { SimulatedTag, Warning } from '../../components/ui/States';
import { Button, IconButton } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/Segmented';
import { TokenPicker } from '../../components/ui/TokenPicker';
import type { PreparedTrade } from '../../services/execution/ExecutionService';
import type { RoutingResult } from '../../services/dex/RoutingEngine';
import { resolveSwapTokens } from '../swapTokens';
import { useActiveWallet, useGlobalContext, useSystem } from '../../state/system';
import { usePortfolio } from '../../state/marketHooks';
import { useModuleConfig, useModuleInputs, useModuleOutputs } from '../../state/moduleIO';
import { formatAmount, formatImpact, formatUsd } from '../../utils/format';

interface Config extends Record<string, unknown> {
  slippagePct: number;
  amount: string;
  adapterId: string;
  /** Tokens pinned on this module, overriding the pair it would otherwise follow. */
  sellSymbol: string | null;
  buySymbol: string | null;
}

type Stage = 'edit' | 'review' | 'working';

/**
 * The one module that can move funds.
 *
 * Flow is deliberately three-step — quote, review, explicit confirm — and the
 * execution service refuses anything that skips it or comes from a watch wallet.
 */
export function Component({ module }: { module: ModuleInstance }) {
  const system = useSystem();
  const inputs = useModuleInputs(module.id);
  const activeWallet = useActiveWallet();
  const [global] = useGlobalContext();
  const [config, setConfig] = useModuleConfig<Config>(module.id, module.configuration as Config);

  const [stage, setStage] = useState<Stage>('edit');
  const [routing, setRouting] = useState<RoutingResult | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [prepared, setPrepared] = useState<PreparedTrade | null>(null);
  const [submitted, setSubmitted] = useState<TxRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const linkedPair = inputs.pair as PairRef | undefined;
  const wallet = (inputs.wallet as WalletRecord | undefined) ?? activeWallet;
  const chainId = wallet?.chainId ?? global.chainId;

  const { sell, buy, sellLocked, buyLocked, pinned } = resolveSwapTokens({
    chainId,
    linkedSell: inputs.tokenA as TokenRef | undefined,
    linkedBuy: inputs.tokenB as TokenRef | undefined,
    linkedPair,
    globalPair: global.pair,
    sellOverride: config.sellSymbol,
    buyOverride: config.buySymbol,
  });

  const linkedAmount = inputs.amount as number | undefined;
  const linkedSlippage = inputs.slippage as number | undefined;
  const slippagePct = linkedSlippage ?? config.slippagePct;
  const amount = linkedAmount !== undefined ? linkedAmount : Number(config.amount) || 0;

  const { data: portfolio } = usePortfolio(wallet, chainId);
  const sellBalance = portfolio?.holdings.find((h) => h.token.symbol === sell?.symbol) ?? null;
  const nativeBalance = portfolio?.holdings.find((h) => h.token.address === 'native') ?? null;

  const quote: Quote | null = useMemo(() => {
    if (!routing) return null;
    if (config.adapterId !== 'auto') {
      return routing.quotes.find((q) => q.adapterId === config.adapterId) ?? routing.best;
    }
    return routing.best;
  }, [routing, config.adapterId]);

  // Re-quote whenever the trade inputs change. Debounced so typing an amount
  // does not fan out a request per keystroke.
  useEffect(() => {
    if (!sell || !buy || !(amount > 0)) {
      setRouting(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const result = await system.routing.quoteAll(
          { source: sell, dest: buy, amountIn: amount, slippagePct, chainId, taker: wallet?.address ?? null },
          {
            sourceBalance: sellBalance,
            nativeBalanceUsd: nativeBalance?.valueUsd,
            supportedChain: system.routing.list(chainId).length > 0,
          },
        );
        if (cancelled) return;
        setRouting(result);
        setError(result.best ? null : result.failures[0]?.reason ?? 'No route found');
        if (result.best) system.bus.emit('QUOTE_UPDATED', { quote: result.best }, module.id);
        else system.bus.emit('QUOTE_FAILED', { reason: result.failures[0]?.reason ?? 'No route' }, module.id);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Quote failed');
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [system, sell, buy, amount, slippagePct, chainId, wallet, sellBalance, nativeBalance, module.id]);

  useModuleOutputs(module.id, {
    quote,
    transaction: submitted,
    amountOut: quote?.amountOut ?? null,
  });

  /**
   * Swap the two sides. The old estimated receive becomes the new sell amount,
   * which is what every trading UI does — and pins both tokens, since the
   * module can no longer be following its pair in the original order.
   */
  const flip = useCallback(() => {
    if (!sell || !buy) return;
    setConfig({
      sellSymbol: buy.symbol,
      buySymbol: sell.symbol,
      amount: quote ? String(Number(quote.amountOut.toPrecision(8))) : '',
    });
    setRouting(null);
  }, [sell, buy, quote, setConfig]);

  const followPair = useCallback(() => {
    setConfig({ sellSymbol: null, buySymbol: null });
    setRouting(null);
  }, [setConfig]);

  const review = useCallback(async () => {
    if (!quote) return;
    setError(null);
    try {
      const adapter = system.routing.get(quote.adapterId);
      if (!adapter) throw new Error('Route adapter is no longer registered');
      const trade = await system.execution.prepare(quote, wallet, adapter, system.chainFor(chainId));
      setPrepared(trade);
      setStage('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare this trade');
    }
  }, [system, quote, wallet, chainId]);

  const confirm = useCallback(async () => {
    if (!prepared) return;
    setStage('working');
    setError(null);
    try {
      const chain = system.chainFor(chainId);
      if (prepared.needsApproval) {
        const approval = await system.execution.approve(prepared, chain);
        // The allowance only exists once the approval settles, so wait for it
        // rather than re-reading a state that has not changed yet.
        const settled = await system.execution.waitForSettlement(approval.id);
        if (settled && settled.status !== 'CONFIRMED') {
          throw new Error(`Approval ${settled.status.toLowerCase()} — the swap cannot proceed`);
        }
        const adapter = system.routing.get(prepared.quote.adapterId)!;
        const next = await system.execution.prepare(prepared.quote, wallet, adapter, chain);
        setPrepared(next);
        setStage('review');
        return;
      }
      const tx = await system.execution.execute(prepared, chain, true);
      setSubmitted(tx);
      setStage('edit');
      setPrepared(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed');
      setStage('review');
    }
  }, [system, prepared, chainId, wallet]);

  if (!sell || !buy) {
    return (
      <div className="empty">
        <h5>NO PAIR</h5>
        <p>Link a Pair Selector, or choose two assets to initialise the terminal.</p>
      </div>
    );
  }

  if (stage === 'review' && prepared) {
    return (
      <ReviewPanel
        trade={prepared}
        working={false}
        error={error}
        onBack={() => {
          setStage('edit');
          setPrepared(null);
        }}
        onConfirm={confirm}
      />
    );
  }
  if (stage === 'working' && prepared) {
    return <ReviewPanel trade={prepared} working error={error} onBack={() => undefined} onConfirm={() => undefined} />;
  }

  const impactTone =
    (quote?.priceImpactPct ?? 0) >= 10 ? 'down' : (quote?.priceImpactPct ?? 0) >= 3 ? 'warning' : 'flat';

  return (
    <>
      <div className="col" style={{ gap: 'var(--space-2)' }}>
        <div className="spread">
          <span className="row" style={{ gap: 'var(--space-2)' }}>
            <span className="label">SELL</span>
            {pinned ? (
              <button
                type="button"
                className="chip"
                data-tone="accent"
                title="Pinned to these tokens — click to follow the linked pair again"
                onClick={followPair}
              >
                PINNED ↺
              </button>
            ) : linkedPair ? (
              <span className="chip" title="Following the linked pair selector">
                FOLLOWING {linkedPair.label}
              </span>
            ) : null}
          </span>
          <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>
            BALANCE {sellBalance ? formatAmount(sellBalance.amount) : '—'} {sell.symbol}
          </span>
        </div>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <div style={{ width: 108 }}>
            <TokenPicker
              chainId={chainId}
              value={sell}
              exclude={buy}
              onChange={(token) => setConfig({ sellSymbol: token.symbol })}
              disabled={sellLocked}
            />
          </div>
          <input
            className="input grow"
            inputMode="decimal"
            placeholder="0.0"
            value={linkedAmount !== undefined ? String(linkedAmount) : config.amount}
            disabled={linkedAmount !== undefined}
            onChange={(event) => setConfig({ amount: event.target.value.replace(/[^0-9.]/g, '') })}
          />
        </div>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          {[25, 50, 75, 100].map((pct) => (
            <Button
              key={pct}
              size="xs"
              block
              disabled={!sellBalance || linkedAmount !== undefined}
              onClick={() => setConfig({ amount: String((sellBalance!.amount * pct) / 100) })}
            >
              {pct === 100 ? 'MAX' : `${pct}%`}
            </Button>
          ))}
        </div>
      </div>

      <div className="swap-flip">
        <span className="swap-flip-rule" aria-hidden />
        <IconButton
          label={
            sellLocked && buyLocked
              ? 'Direction is set by the linked tokens'
              : `Flip direction — sell ${buy.symbol} for ${sell.symbol}`
          }
          size="md"
          disabled={sellLocked && buyLocked}
          onClick={flip}
        >
          ⇅
        </IconButton>
        <span className="swap-flip-rule" aria-hidden />
      </div>

      <div className="col" style={{ gap: 'var(--space-2)' }}>
        <span className="label">BUY</span>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <div style={{ width: 108 }}>
            <TokenPicker
              chainId={chainId}
              value={buy}
              exclude={sell}
              onChange={(token) => setConfig({ buySymbol: token.symbol })}
              disabled={buyLocked}
            />
          </div>
          <div className="input grow mono-num" style={{ display: 'flex', alignItems: 'center' }}>
            {quoting && !quote ? '…' : quote ? formatAmount(quote.amountOut) : '0.0'}
          </div>
        </div>
      </div>

      {quote ? (
        <div className="col" style={{ gap: 2, fontSize: 'var(--text-3xs)' }}>
          <Row label="ROUTE" value={`${quote.adapterLabel} · ${quote.route[0]?.path.join(' → ') ?? '—'}`} />
          <Row
            label="PRICE IMPACT"
            value={formatImpact(quote.priceImpactPct)}
            tone={impactTone === 'down' ? 'down' : undefined}
          />
          <Row label="MIN RECEIVED" value={`${formatAmount(quote.minAmountOut)} ${buy.symbol}`} />
          <Row label="SLIPPAGE" value={`${slippagePct}%`} />
          <Row label="NETWORK FEE" value={`${formatUsd(quote.gasCostUsd)} · ${quote.gasEstimate.toLocaleString()} gas`} />
          {routing && routing.quotes.length > 1 ? (
            <Row label="VENUES" value={`${routing.quotes.length} quoted · best selected`} />
          ) : null}
        </div>
      ) : null}

      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <span className="label">SLIPPAGE</span>
        <Segmented
          label="Slippage tolerance"
          value={slippagePct}
          disabled={linkedSlippage !== undefined}
          options={[0.1, 0.5, 1, 3].map((value) => ({ value, label: `${value}%` }))}
          onChange={(value) => setConfig({ slippagePct: value })}
        />
      </div>

      {quote?.warnings.map((warning) => (
        <Warning key={warning.code} tone={warning.severity === 'error' ? 'error' : warning.severity === 'info' ? 'info' : 'warning'}>
          {warning.message}
        </Warning>
      ))}

      {error ? <Warning tone="error">{error}</Warning> : null}
      {!wallet ? <Warning tone="info">Connect a wallet to review and execute this trade.</Warning> : null}
      {wallet?.watchOnly ? <Warning>Watch wallet selected — this trade cannot be signed.</Warning> : null}

      {submitted ? (
        <div className="col" style={{ gap: 2 }}>
          <span className="chip" data-tone="success">
            {submitted.simulated ? 'SIMULATED TX SUBMITTED' : 'TX SUBMITTED'}
          </span>
          <span className="faint truncate" style={{ fontSize: 'var(--text-3xs)' }}>
            {submitted.hash}
          </span>
        </div>
      ) : null}

      <span className="grow" />
      <Button
        variant="primary"
        size="lg"
        block
        loading={quoting && !quote}
        disabled={!quote || !wallet || wallet.watchOnly}
        onClick={review}
      >
        {quoting && !quote ? 'QUOTING' : 'REVIEW TRADE'}
      </Button>
    </>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'down' }) {
  return (
    <div className="spread">
      <span className="faint">{label}</span>
      <span className={`mono-num truncate ${tone === 'down' ? 'down' : ''}`} style={{ maxWidth: '62%', textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}

/** Full disclosure screen. Everything the user is agreeing to, before signing. */
function ReviewPanel({
  trade,
  working,
  error,
  onBack,
  onConfirm,
}: {
  trade: PreparedTrade;
  working: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { quote, wallet, request } = trade;
  return (
    <>
      <div className="spread">
        <span className="label">CONFIRM TRADE</span>
        {quote.simulated ? <SimulatedTag label="SIMULATED EXECUTION" /> : null}
      </div>

      <div className="col" style={{ gap: 2, fontSize: 'var(--text-3xs)' }}>
        <Row label="SELL" value={`${formatAmount(quote.amountIn)} ${quote.source.symbol}`} />
        <Row label="RECEIVE (EST.)" value={`${formatAmount(quote.amountOut)} ${quote.dest.symbol}`} />
        <Row label="MINIMUM RECEIVED" value={`${formatAmount(quote.minAmountOut)} ${quote.dest.symbol}`} />
        <Row label="PRICE IMPACT" value={formatImpact(quote.priceImpactPct)} />
        <Row label="SLIPPAGE" value={`${quote.slippagePct}%`} />
        <Row label="ROUTE" value={quote.route.map((leg) => `${leg.dex} ${leg.portionPct}%`).join(' · ')} />
        <Row label="PATH" value={quote.route[0]?.path.join(' → ') ?? '—'} />
        <Row label="PROTOCOL" value={quote.adapterLabel} />
        <Row label="CONTRACT" value={request.to} />
        <Row label="WALLET" value={String(wallet.address)} />
        <Row label="NETWORK" value={`CHAIN ${request.chainId}`} />
        <Row label="GAS ESTIMATE" value={`${quote.gasEstimate.toLocaleString()} · ${formatUsd(quote.gasCostUsd)}`} />
        <Row
          label="SIMULATION"
          value={trade.simulation.ok ? trade.simulation.reason ?? 'PASSED' : `FAILED — ${trade.simulation.reason}`}
        />
      </div>

      <Warning tone="info">
        Estimated values. The final fill depends on chain state at execution time.
      </Warning>

      {trade.needsApproval ? (
        <Warning>
          {quote.source.symbol} must be approved for {quote.adapterLabel} first. Approval is a separate transaction.
        </Warning>
      ) : null}

      {trade.blockers.map((blocker) => (
        <Warning key={blocker} tone="error">
          {blocker}
        </Warning>
      ))}
      {error ? <Warning tone="error">{error}</Warning> : null}

      <span className="grow" />
      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <Button size="lg" onClick={onBack} disabled={working}>
          BACK
        </Button>
        <Button
          variant="primary"
          size="lg"
          block
          loading={working}
          disabled={!trade.needsApproval && trade.blockers.length > 0}
          onClick={onConfirm}
        >
          {working ? 'SUBMITTING' : trade.needsApproval ? `APPROVE ${quote.source.symbol}` : 'CONFIRM TRADE'}
        </Button>
      </div>
    </>
  );
}
