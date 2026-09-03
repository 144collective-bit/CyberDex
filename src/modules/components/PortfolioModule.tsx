import { useMemo, useState } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import type { TokenBalance, WalletRecord } from '../../core/types';
import { EmptyState, ErrorState, LoadingState, SimulatedTag, Stat } from '../../components/ui/States';
import { TokenAvatar } from '../../components/ui/TokenPicker';
import { Segmented } from '../../components/ui/Segmented';
import { useActiveWallet, useGlobalContext, useSystem } from '../../state/system';
import { usePortfolio } from '../../state/marketHooks';
import { useModuleConfig, useModuleInputs, useModuleOutputs } from '../../state/moduleIO';
import { formatAmount, formatPct, formatUsd } from '../../utils/format';
import { Button } from '../../components/ui/Button';

interface Config extends Record<string, unknown> {
  sort: 'value' | 'amount' | 'symbol';
  hideDust: boolean;
}

export function Component({ module }: { module: ModuleInstance }) {
  const system = useSystem();
  const inputs = useModuleInputs(module.id);
  const activeWallet = useActiveWallet();
  const [global] = useGlobalContext();
  const [config, setConfig] = useModuleConfig<Config>(module.id, module.configuration as Config);
  const [selected, setSelected] = useState<string | null>(null);

  const wallet = (inputs.wallet as WalletRecord | undefined) ?? activeWallet;
  const { data, loading, error } = usePortfolio(wallet, wallet?.chainId ?? global.chainId);

  const holdings = useMemo(() => {
    const list = (data?.holdings ?? []).filter((h) => !config.hideDust || h.valueUsd >= 1);
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (config.sort === 'symbol') return a.token.symbol.localeCompare(b.token.symbol);
      if (config.sort === 'amount') return b.amount - a.amount;
      return b.valueUsd - a.valueUsd;
    });
    return sorted;
  }, [data, config.sort, config.hideDust]);

  const selectedBalance = holdings.find((h) => h.token.symbol === selected) ?? null;

  useModuleOutputs(module.id, {
    totalValue: data?.totalValueUsd ?? null,
    token: selectedBalance?.token ?? null,
    balance: selectedBalance ?? null,
  });

  const pick = (balance: TokenBalance) => {
    setSelected(balance.token.symbol);
    system.bus.emit('TOKEN_SELECTED', { token: balance.token, source: module.id }, module.id);
  };

  if (!wallet) {
    return (
      <EmptyState
        title="NO WALLET CONNECTED"
        message="Connect a wallet to activate portfolio data, or link a Wallet module into this one."
        action={
          <Button variant="primary" onClick={() => system.wallets.addDemoWallet()}>
            USE A DEMO WALLET
          </Button>
        }
      />
    );
  }
  if (loading && !data) return <LoadingState label="READING BALANCES" />;
  if (error) return <ErrorState title="PORTFOLIO UNAVAILABLE" message={error} />;

  return (
    <>
      <div className="spread">
        <Stat
          label="TOTAL VALUE"
          value={formatUsd(data?.totalValueUsd ?? 0, { compact: true })}
          size="xl"
          sub={wallet.label}
          flashOn={data?.totalValueUsd ?? null}
        />
        <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
          <span className={`mono-num ${(data?.change24hPct ?? 0) >= 0 ? 'up' : 'down'}`}>
            {formatPct(data?.change24hPct ?? null)} 24H
          </span>
          <span className={`mono-num faint`}>{formatPct(data?.change7dPct ?? null)} 7D</span>
          {data?.simulated ? <SimulatedTag label="DEMO" /> : null}
        </div>
      </div>

      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <Segmented
          label="Sort holdings"
          value={config.sort}
          options={[
            { value: 'value', label: 'VALUE' },
            { value: 'amount', label: 'AMOUNT' },
            { value: 'symbol', label: 'SYMBOL' },
          ]}
          onChange={(sort) => setConfig({ sort })}
        />
        <span className="grow" />
        <Segmented
          label="Dust filter"
          value={config.hideDust ? 'hide' : 'show'}
          options={[
            { value: 'hide', label: 'HIDE DUST' },
            { value: 'show', label: 'ALL' },
          ]}
          onChange={(value) => setConfig({ hideDust: value === 'hide' })}
        />
      </div>

      <div className="scroll-y grow" style={{ margin: '0 calc(var(--space-4) * -1)' }}>
        <table className="dtable">
          <thead>
            <tr>
              <th>ASSET</th>
              <th className="num">AMOUNT</th>
              <th className="num">VALUE</th>
              <th className="num">WEIGHT</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((holding) => {
              const weight = data?.totalValueUsd ? (holding.valueUsd / data.totalValueUsd) * 100 : 0;
              return (
                <tr
                  key={holding.token.address}
                  data-selected={selected === holding.token.symbol}
                  onClick={() => pick(holding)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <span className="row" style={{ gap: 'var(--space-2)' }}>
                      <TokenAvatar token={holding.token} size={13} />
                      {holding.token.symbol}
                    </span>
                  </td>
                  <td className="num">{formatAmount(holding.amount)}</td>
                  <td className="num">{formatUsd(holding.valueUsd, { compact: true })}</td>
                  <td className="num">{weight.toFixed(1)}%</td>
                </tr>
              );
            })}
            {holdings.length === 0 ? (
              <tr>
                <td colSpan={4} className="faint" style={{ padding: 'var(--space-5)' }}>
                  NO BALANCES ON THIS NETWORK
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
