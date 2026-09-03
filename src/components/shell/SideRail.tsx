import { useState } from 'react';
import { ROUTE_META } from '../../state/router';
import type { RouteId } from '../../state/router';

/**
 * Vertical navigation. Collapsed by default and expands on hover or focus;
 * while collapsed each icon carries a CSS tooltip built from its label, so the
 * rail is never a row of unexplained glyphs.
 */
export function SideRail({
  route,
  navigate,
  onAddModule,
}: {
  route: RouteId;
  navigate: (route: RouteId) => void;
  onAddModule: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <nav
      className="rail"
      data-open={open ? 'true' : 'false'}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      aria-label="Primary"
    >
      <button
        type="button"
        className="rail-btn"
        data-label="ADD MODULE ⌘M"
        onClick={onAddModule}
        title="Add module (⌘M)"
      >
        <span className="rail-icon" aria-hidden>
          +
        </span>
        <span>ADD MODULE</span>
      </button>

      <div className="divider" />

      {(Object.keys(ROUTE_META) as RouteId[]).map((id) => (
        <button
          key={id}
          type="button"
          className="rail-btn"
          data-active={route === id}
          data-label={ROUTE_META[id].label}
          onClick={() => navigate(id)}
          aria-current={route === id ? 'page' : undefined}
        >
          <span className="rail-icon" aria-hidden>
            {ROUTE_META[id].icon}
          </span>
          <span>{ROUTE_META[id].label}</span>
        </button>
      ))}

      <span className="grow" />

      <button
        type="button"
        className="rail-btn"
        data-label={open ? 'COLLAPSE' : 'EXPAND'}
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? 'Collapse navigation' : 'Expand navigation'}
      >
        <span className="rail-icon" aria-hidden>
          {open ? '‹' : '›'}
        </span>
        <span>COLLAPSE</span>
      </button>
    </nav>
  );
}
