import { useEffect, useState } from 'react';
import type { EventRecord } from '../../core/events/types';
import { useActiveDeck } from '../../state/deck';
import { useGlobalContext, useNetworkTelemetry, useSystem } from '../../state/system';
import { formatTime } from '../../utils/format';

/** Bottom status strip: system health plus the last few bus events. */
export function StatusBar() {
  const system = useSystem();
  const deck = useActiveDeck();
  const [global] = useGlobalContext();
  const { status, gas } = useNetworkTelemetry(global.chainId);
  const [last, setLast] = useState<EventRecord | null>(null);

  useEffect(() => system.bus.onAny((record) => setLast(record)), [system]);

  return (
    <footer className="statusbar">
      <span className="row" style={{ gap: 'var(--space-2)' }}>
        <span className="dot" data-tone={status.rpc === 'online' ? 'success' : status.rpc === 'offline' ? 'error' : 'warning'} />
        RPC {status.rpc}
      </span>
      <span className="row" style={{ gap: 'var(--space-2)' }}>
        <span className="dot" data-tone={status.indexer === 'online' ? 'success' : 'warning'} />
        INDEXER {status.indexer}
      </span>
      <span className="row" style={{ gap: 'var(--space-2)' }}>
        <span className="dot" data-tone={status.router === 'online' ? 'success' : 'warning'} />
        ROUTER {status.router}
      </span>
      <span>BLOCK {gas?.blockNumber.toLocaleString() ?? '—'}</span>
      <span>
        {deck.modules.length} MODULES · {deck.connections.length} LINKS
      </span>
      <span className="grow" />
      {last ? (
        <span className="truncate" style={{ maxWidth: '40vw' }}>
          {formatTime(last.at)} · {last.type} · {last.origin}
        </span>
      ) : null}
    </footer>
  );
}
