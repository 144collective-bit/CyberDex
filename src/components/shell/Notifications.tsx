import { useEffect } from 'react';
import { useNotifications, useSystem } from '../../state/system';
import { formatRelative } from '../../utils/format';

/** Transient stack. Sticky items (errors, alerts) stay until dismissed. */
export function ToastStack() {
  const system = useSystem();
  const notifications = useNotifications();
  const visible = notifications.slice(0, 4);

  useEffect(() => {
    const timers = visible
      .filter((item) => item.ttlMs > 0)
      .map((item) =>
        setTimeout(() => system.notifications.dismiss(item.id), Math.max(0, item.at + item.ttlMs - Date.now())),
      );
    return () => timers.forEach(clearTimeout);
  }, [visible, system]);

  if (!visible.length) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {visible.map((item) => (
        <div key={item.id} className="toast" data-kind={item.kind}>
          <div className="spread">
            <span className="label">{item.title}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Dismiss"
              onClick={() => system.notifications.dismiss(item.id)}
            >
              ×
            </button>
          </div>
          {item.detail ? <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>{item.detail}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function NotificationDrawer({ onClose }: { onClose: () => void }) {
  const system = useSystem();
  const notifications = useNotifications();

  useEffect(() => {
    system.notifications.markAllRead();
  }, [system]);

  return (
    <aside className="drawer" aria-label="Notification centre">
      <div className="panel-head">
        <span className="panel-title">NOTIFICATIONS</span>
        <span className="grow" />
        <button type="button" className="btn" data-variant="ghost" onClick={() => system.notifications.clear()}>
          CLEAR
        </button>
        <button type="button" className="icon-btn" aria-label="Close notifications" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="scroll-y grow">
        {notifications.length === 0 ? (
          <div className="empty">
            <h5>NOTHING YET</h5>
            <p>Trades, alerts and system notices arrive here.</p>
          </div>
        ) : (
          notifications.map((item) => (
            <div
              key={item.id}
              className="col"
              style={{ gap: 2, padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--border-faint)' }}
            >
              <div className="spread">
                <span className="chip" data-tone={toneFor(item.kind)}>
                  {item.kind.toUpperCase()}
                </span>
                <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>
                  {formatRelative(item.at)} AGO
                </span>
              </div>
              <span>{item.title}</span>
              {item.detail ? <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>{item.detail}</span> : null}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function toneFor(kind: string): string | undefined {
  switch (kind) {
    case 'success':
      return 'success';
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'alert':
      return 'accent';
    case 'transaction':
      return 'info';
    default:
      return undefined;
  }
}
