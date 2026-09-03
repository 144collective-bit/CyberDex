import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'default' | 'primary' | 'danger' | 'ghost';
type Size = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: Variant;
  size?: Size;
  /** Renders in the active/selected state. */
  active?: boolean;
  /** Shows a spinner and blocks interaction without collapsing the layout. */
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

/**
 * The one button in the app.
 *
 * Everything visual lives in CSS keyed off data attributes, so a theme change
 * or a density change never needs a component edit.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'sm', active, loading, block, icon, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className="btn"
      data-variant={variant}
      data-size={size}
      data-active={active ? 'true' : undefined}
      data-loading={loading ? 'true' : undefined}
      data-block={block ? 'true' : undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="btn-spinner" aria-hidden /> : icon ? <span aria-hidden>{icon}</span> : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Required: an icon alone is never self-describing. */
  label: string;
  active?: boolean;
  tone?: 'default' | 'danger';
  size?: 'sm' | 'md';
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, tone = 'default', size = 'sm', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className="icon-btn"
      aria-label={label}
      title={label}
      data-active={active ? 'true' : undefined}
      data-tone={tone === 'danger' ? 'danger' : undefined}
      data-size={size === 'md' ? 'md' : undefined}
      {...rest}
    >
      {children}
    </button>
  );
});
