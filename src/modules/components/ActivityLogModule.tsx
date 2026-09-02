import { useEffect, useState } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import type { EventRecord } from '../../core/events/types';
import { useSystem } from '../../state/system';
import { formatTime } from '../../utils/format';

/** The deck's black box: every system event, in order, as it happened. */
export function Component(_props: { module: ModuleInstance }) {
  const system = useSystem();
  const [records, setRecords] = useState<EventRecord[]>(() => [...system.bus.getHistory()].reverse());

  useEffect(
    () => system.bus.onAny((record) => setRecords((prev) => [record, ...prev].slice(0, 200))),
    [system],
  );

  return (
    <div className="scroll-y" style={{ height: '100%' }}>
      <table className="dtable">
        <thead>
          <tr>
            <th>TIME</th>
            <th>EVENT</th>
            <th>ORIGIN</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td className="faint mono-num">{formatTime(record.at)}</td>
              <td>{record.type}</td>
              <td className="faint truncate" style={{ maxWidth: 150 }}>
                {record.origin}
              </td>
            </tr>
          ))}
          {records.length === 0 ? (
            <tr>
              <td colSpan={3} className="faint" style={{ padding: 'var(--space-5)' }}>
                NO EVENTS YET
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
