import type { ReactNode } from 'react';

/**
 * Module-scoped states. Nothing in the app shows a page-wide spinner: a module
 * that is loading, empty or broken says so inside its own frame while the rest
 * of the deck stays usable.
 */
export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h5>{title}</h5>
      <p>{message}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'ERROR',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="empty">
      <h5 style={{ color: 'var(--error)' }}>{title}</h5>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          RETRY
        </button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = 'LOADING' }: { label?: string }) {
  return (
    <div className="col" style={{ gap: 'var(--space-3)', padding: 'var(--space-2) 0' }}>
      <div className="label">{label}…</div>
      <div className="skeleton" style={{ width: '70%' }} />
      <div className="skeleton" style={{ width: '45%' }} />
      <div className="skeleton" style={{ width: '58%' }} />
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
  sub,
  size = 'md',
}: {
  label: string;
  value: ReactNode;
  tone?: 'up' | 'down' | 'flat';
  sub?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const color = tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--text)';
  const fontSize = size === 'lg' ? 'var(--text-xl)' : size === 'sm' ? 'var(--text-xs)' : 'var(--text-lg)';
  return (
    <div className="col" style={{ gap: 2, minWidth: 0 }}>
      <span className="label">{label}</span>
      <span className="mono-num truncate" style={{ fontSize, color, lineHeight: 1.1 }}>
        {value}
      </span>
      {sub ? <span className="faint truncate" style={{ fontSize: 'var(--text-3xs)' }}>{sub}</span> : null}
    </div>
  );
}

export function SimulatedTag({ label = 'SIMULATED' }: { label?: string }) {
  return (
    <span className="simulated-tag" title="Demo data — not a live on-chain value">
      ▲ {label}
    </span>
  );
}

export function Warning({
  tone = 'warning',
  children,
}: {
  tone?: 'warning' | 'error' | 'info';
  children: ReactNode;
}) {
  return (
    <div className="alert-banner" data-tone={tone === 'warning' ? undefined : tone}>
      <span aria-hidden>{tone === 'error' ? '✕' : tone === 'info' ? 'i' : '!'}</span>
      <span>{children}</span>
    </div>
  );
}
