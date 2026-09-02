import { useMemo } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import type { TxRecord, TxStatus, WalletRecord } from '../../core/types';
import { EmptyState } from '../../components/ui/States';
import { useActiveWallet, useTransactions } from '../../state/system';
import { useModuleConfig, useModuleInputs, useModuleOutputs } from '../../state/moduleIO';
import { formatRelative } from '../../utils/format';

interface Config extends Record<string, unknown> {
  filter: 'all' | 'swap' | 'approval' | 'pending';
}

const STATUS_TONE: Record<TxStatus, string> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  FAILED: 'error',
  REJECTED: 'error',
};

export function Component({ module }: { module: ModuleInstance }) {
  const records = useTransactions();
  const inputs = useModuleInputs(module.id);
  const activeWallet = useActiveWallet();
  const [config, setConfig] = useModuleConfig<Config>(module.id, module.configuration as Config);

  const wallet = (inputs.wallet as WalletRecord | undefined) ?? activeWallet;

  const rows = useMemo(() => {
    let list: TxRecord[] = wallet
      ? records.filter((tx) => String(tx.wallet).toLowerCase() === String(wallet.address).toLowerCase())
      : records;
    if (config.filter === 'swap') list = list.filter((tx) => tx.type === 'SWAP');
    if (config.filter === 'approval') list = list.filter((tx) => tx.type === 'APPROVAL');
    if (config.filter === 'pending') list = list.filter((tx) => tx.status === 'PENDING');
    return list;
  }, [records, wallet, config.filter]);

  useModuleOutputs(module.id, { latest: rows[0] ?? null });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        className="row"
        style={{ gap: 2, padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-faint)' }}
      >
        {(['all', 'swap', 'approval', 'pending'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className="btn"
            data-variant="ghost"
            data-active={config.filter === key}
            style={{ minHeight: 18 }}
            onClick={() => setConfig({ filter: key })}
          >
            {key.toUpperCase()}
          </button>
        ))}
        <span className="grow" />
        <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>
          {rows.length} RECORDS
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="NO TRANSACTIONS"
          message="Executed and simulated trades from this deck appear here, newest first."
        />
      ) : (
        <div className="scroll-y grow">
          <table className="dtable">
            <thead>
              <tr>
                <th>TIME</th>
                <th>TYPE</th>
                <th>DETAIL</th>
                <th>STATUS</th>
                <th>HASH</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tx) => (
                <tr key={tx.id}>
                  <td className="faint">{formatRelative(tx.timestamp)} ago</td>
                  <td>{tx.type}</td>
                  <td className="truncate" style={{ maxWidth: 240 }} title={tx.summary}>
                    {tx.summary}
                    {tx.simulated ? <span className="simulated-tag" style={{ marginLeft: 6 }}>SIM</span> : null}
                  </td>
                  <td>
                    <span className="chip" data-tone={STATUS_TONE[tx.status]}>
                      {tx.status}
                    </span>
                  </td>
                  <td className="faint truncate" style={{ maxWidth: 130 }} title={tx.hash ?? ''}>
                    {tx.hash ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
