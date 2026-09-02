import { useEffect, useMemo, useRef, useState } from 'react';
import type { TokenRef } from '../../core/types';
import { tokensForChain } from '../../services/market/tokens';

export function TokenAvatar({ token, size = 16 }: { token: TokenRef; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        background: `color-mix(in srgb, ${token.color ?? 'var(--accent)'} 22%, transparent)`,
        border: `1px solid ${token.color ?? 'var(--accent)'}`,
        color: token.color ?? 'var(--accent)',
        fontSize: Math.max(7, size * 0.42),
        letterSpacing: 0,
      }}
    >
      {token.symbol.slice(0, 2)}
    </span>
  );
}

/** Compact searchable token selector used by every token-taking module. */
export function TokenPicker({
  chainId,
  value,
  onChange,
  label,
  disabled,
  exclude,
}: {
  chainId: number;
  value: TokenRef | null;
  onChange: (token: TokenRef) => void;
  label?: string;
  disabled?: boolean;
  exclude?: TokenRef | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    const all = tokensForChain(chainId).filter(
      (token) => !exclude || token.address.toLowerCase() !== exclude.address.toLowerCase(),
    );
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (token) =>
        token.symbol.toLowerCase().includes(q) ||
        token.name.toLowerCase().includes(q) ||
        token.address.toLowerCase().includes(q),
    );
  }, [chainId, query, exclude]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative', minWidth: 0 }}>
      {label ? <div className="label" style={{ marginBottom: 2 }}>{label}</div> : null}
      <button
        type="button"
        className="btn"
        style={{ width: '100%', justifyContent: 'space-between' }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="row" style={{ gap: 'var(--space-2)', minWidth: 0 }}>
          {value ? <TokenAvatar token={value} /> : null}
          <span className="truncate">{value ? value.symbol : 'SELECT'}</span>
        </span>
        <span aria-hidden style={{ opacity: 0.6 }}>▾</span>
      </button>

      {open ? (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 2px)',
            left: 0,
            right: 0,
            zIndex: 60,
            background: 'var(--surface-overlay)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-xs)',
            boxShadow: 'var(--shadow-float)',
            maxHeight: 240,
            overflow: 'auto',
            minWidth: 180,
          }}
        >
          <input
            className="input"
            autoFocus
            placeholder="SEARCH TOKEN OR ADDRESS"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ border: 'none', borderBottom: '1px solid var(--border)', borderRadius: 0 }}
          />
          {options.length === 0 ? (
            <div className="faint" style={{ padding: 'var(--space-4)', fontSize: 'var(--text-3xs)' }}>
              NO TOKEN MATCHES — check the address or switch network
            </div>
          ) : null}
          {options.map((token) => (
            <button
              key={token.address}
              type="button"
              role="option"
              aria-selected={value?.address === token.address}
              className="palette-item"
              data-active={value?.address === token.address}
              onClick={() => {
                onChange(token);
                setOpen(false);
                setQuery('');
              }}
            >
              <TokenAvatar token={token} />
              <span className="grow truncate">{token.symbol}</span>
              <span className="faint truncate" style={{ fontSize: 'var(--text-3xs)', maxWidth: 90 }}>
                {token.name}
              </span>
              {token.verified === false ? <span className="chip" data-tone="warning">UNVERIFIED</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
