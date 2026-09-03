import { useRef } from 'react';
import type { ReactNode } from 'react';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  hint?: string;
  disabled?: boolean;
}

/**
 * Segmented control for mutually exclusive choices — timeframes, filters, sort
 * keys, slippage presets. Arrow keys move between segments, matching the radio
 * group pattern it exposes to assistive tech.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size = 'sm',
  block,
  disabled,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
  block?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const move = (direction: 1 | -1) => {
    const enabled = options.filter((option) => !option.disabled);
    const index = enabled.findIndex((option) => option.value === value);
    const next = enabled[(index + direction + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    // Keep focus on the segment the user just moved to.
    requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLButtonElement>(`[data-value="${String(next.value)}"]`)?.focus();
    });
  };

  return (
    <div
      ref={ref}
      className="segmented"
      role="radiogroup"
      aria-label={label}
      data-size={size}
      data-block={block ? 'true' : undefined}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className="segment"
          role="radio"
          aria-checked={option.value === value}
          data-value={String(option.value)}
          title={option.hint}
          disabled={disabled || option.disabled}
          tabIndex={option.value === value ? 0 : -1}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
