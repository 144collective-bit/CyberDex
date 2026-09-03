import type { ReactNode } from 'react';
import { useValueFlash } from './useValueFlash';
import { Button } from './Button';

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
        <Button onClick={onRetry}>
          RETRY
        </Button>
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

/**
 * A labelled number.
 *
 * The label is small, uppercase and quiet; the value is large, mixed case and
 * tabular. Pass `flashOn` and the value flashes green or red when it moves,
 * the way a trading terminal signals a tick.
 */
export function Stat({
  label,
  value,
  tone,
  sub,
  size = 'md',
  flashOn,
}: {
  label: string;
  value: ReactNode;
  tone?: 'up' | 'down' | 'flat';
  sub?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Numeric value behind the display string, watched for movement. */
  flashOn?: number | null;
}) {
  const flash = useValueFlash(flashOn);
  return (
    <div className="col" style={{ gap: 2, minWidth: 0 }}>
      <span className="label">{label}</span>
      <span
        className="value truncate"
        data-size={size}
        data-tone={tone === 'up' || tone === 'down' ? tone : undefined}
        data-flash={flash ?? undefined}
      >
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
