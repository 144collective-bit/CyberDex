import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type MenuEntry =
  | {
      kind?: 'item';
      id: string;
      label: ReactNode;
      hint?: string;
      icon?: ReactNode;
      tone?: 'default' | 'danger';
      checked?: boolean;
      disabled?: boolean;
      onSelect: () => void;
      /** Keeps the menu open — for toggles the user may hit repeatedly. */
      keepOpen?: boolean;
    }
  | { kind: 'separator'; id: string }
  | { kind: 'header'; id: string; label: string };

function isItem(entry: MenuEntry): entry is Extract<MenuEntry, { kind?: 'item' }> {
  return entry.kind === undefined || entry.kind === 'item';
}

/**
 * Dropdown menu.
 *
 * Full keyboard support (Arrow keys, Home/End, Enter, Escape), click-outside to
 * close, focus returned to the trigger on close, and `menu`/`menuitem` roles —
 * a terminal is useless if you have to reach for the mouse.
 */
export function Menu({
  trigger,
  entries,
  align = 'start',
  label,
  side = 'down',
}: {
  /** Receives the props the trigger element must spread. */
  trigger: (props: {
    onClick: () => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls': string;
    ref: React.Ref<HTMLButtonElement>;
  }) => ReactNode;
  entries: MenuEntry[];
  align?: 'start' | 'end';
  label: string;
  side?: 'down' | 'up';
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const items = entries.filter(isItem).filter((item) => !item.disabled);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const run = (item: Extract<MenuEntry, { kind?: 'item' }>) => {
    item.onSelect();
    if (!item.keepOpen) close();
  };

  return (
    <div className="menu-anchor" ref={anchorRef}>
      {trigger({
        ref: triggerRef,
        onClick: () => {
          setActiveIndex(0);
          setOpen((prev) => !prev);
        },
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setActiveIndex(0);
            setOpen(true);
          }
        },
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': menuId,
      })}

      {open ? (
        <div
          id={menuId}
          className="menu"
          role="menu"
          aria-label={label}
          data-align={align}
          data-side={side}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((prev) => (prev + 1) % Math.max(items.length, 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((prev) => (prev - 1 + items.length) % Math.max(items.length, 1));
            } else if (event.key === 'Home') {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              setActiveIndex(items.length - 1);
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              const item = items[activeIndex];
              if (item) run(item);
            } else if (event.key === 'Tab') {
              close(false);
            }
          }}
        >
          {entries.map((entry) => {
            if (entry.kind === 'separator') return <div key={entry.id} className="menu-separator" role="separator" />;
            if (entry.kind === 'header') {
              return (
                <div key={entry.id} className="menu-header">
                  {entry.label}
                </div>
              );
            }
            const index = items.indexOf(entry);
            return (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                className="menu-item"
                data-tone={entry.tone === 'danger' ? 'danger' : undefined}
                data-checked={entry.checked ? 'true' : undefined}
                data-active={index === activeIndex ? 'true' : undefined}
                disabled={entry.disabled}
                // Autofocus the first item so the keyboard path works immediately.
                autoFocus={index === 0}
                onMouseEnter={() => index >= 0 && setActiveIndex(index)}
                onClick={() => run(entry)}
              >
                {entry.icon !== undefined ? (
                  <span className="menu-icon" aria-hidden>
                    {entry.icon}
                  </span>
                ) : entry.checked !== undefined ? (
                  <span className="menu-icon" aria-hidden>
                    {entry.checked ? '✓' : ''}
                  </span>
                ) : null}
                <span className="truncate">{entry.label}</span>
                {entry.hint ? <span className="menu-hint">{entry.hint}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
