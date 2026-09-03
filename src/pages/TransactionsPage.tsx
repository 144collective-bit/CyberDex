import { useMemo, useState } from 'react';
import type { TxStatus } from '../core/types';
import { shortAddress } from '../services/wallet/WalletService';
import { useSystem, useTransactions } from '../state/system';
import { formatRelative, formatTime } from '../utils/format';
import { Button } from '../components/ui/Button';
import { Segmented } from '../components/ui/Segmented';

const TONE: Record<TxStatus, string> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  FAILED: 'error',
  REJECTED: 'error',
};

export function TransactionsPage() {
  const system = useSystem();
  const records = useTransactions();
  const [filter, setFilter] = useState<'all' | 'simulated' | 'live'>('all');

  const rows = useMemo(
    () =>
      records.filter((tx) =>
        filter === 'all' ? true : filter === 'simulated' ? tx.simulated : !tx.simulated,
      ),
    [records, filter],
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>TRANSACTIONS</h1>
          <p className="faint">Simulated records are labelled and never presented as settled on-chain activity.</p>
        </div>
        <div className="row wrap" style={{ gap: 'var(--space-4)' }}>
          <Segmented
            label="Transaction source"
            size="md"
            value={filter}
            options={[
              { value: 'all', label: 'ALL' },
              { value: 'live', label: 'LIVE' },
              { value: 'simulated', label: 'SIMULATED' },
            ]}
            onChange={setFilter}
          />
          <Button variant="danger" onClick={() => system.ledger.clear()}>
            CLEAR LEDGER
          </Button>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="dtable">
          <thead>
            <tr>
              <th>TIME</th>
              <th>TYPE</th>
              <th>SUMMARY</th>
              <th>WALLET</th>
              <th>CHAIN</th>
              <th>STATUS</th>
              <th>HASH</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tx) => (
              <tr key={tx.id}>
                <td className="faint">
                  {formatTime(tx.timestamp)} · {formatRelative(tx.timestamp)} ago
                </td>
                <td>{tx.type}</td>
                <td className="truncate" style={{ maxWidth: 320 }}>
                  {tx.summary}
                  {tx.simulated ? <span className="simulated-tag" style={{ marginLeft: 6 }}>SIMULATED</span> : null}
                </td>
                <td className="mono-num">{shortAddress(String(tx.wallet))}</td>
                <td className="mono-num">{tx.chainId}</td>
                <td>
                  <span className="chip" data-tone={TONE[tx.status]}>
                    {tx.status}
                  </span>
                </td>
                <td className="faint truncate" style={{ maxWidth: 180 }}>
                  {tx.hash ?? '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="empty">
                    <h5>NO TRANSACTIONS</h5>
                    <p>Trades executed from a Swap module land here with their full route and status.</p>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
