import { Component as ReactComponent, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { getModuleDefinition } from '../../core/modules/registry';
import { canConnect } from '../../core/modules/ports';
import type { PortDataType } from '../../core/modules/ports';
import { getModuleComponent } from '../../modules/components';
import { Button, IconButton } from '../ui/Button';
import { Menu } from '../ui/Menu';
import type { MenuEntry } from '../ui/Menu';
import { useDeckActions, useDeckModule, useDeskUI } from '../../state/deck';
import { incomingLinks } from '../../core/graph/linkGraph';
import { useActiveDeck } from '../../state/deck';
import { ModulePorts } from './ModulePorts';
import { ModuleSettings } from './ModuleSettings';
import { HEADER_HEIGHT } from './geometry';
import { computeSnap, findSwapTarget, moduleRect, snapToGrid } from './layout';

/** One broken module must never take the deck down with it. */
class ModuleErrorBoundary extends ReactComponent<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[module] ${this.props.name} crashed`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty">
          <h5 style={{ color: 'var(--error)' }}>MODULE ERROR</h5>
          <p>{this.state.error.message}</p>
          <Button onClick={() => this.setState({ error: null })}>RELOAD MODULE</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  /** Desk scroll at gesture start, so edge auto-scroll is accounted for. */
  startScrollLeft: number;
  startScrollTop: number;
  originX: number;
  originY: number;
  mode: 'move' | 'resize-se' | 'resize-e' | 'resize-s';
  originW: number;
  originH: number;
  /** Set when the gesture is abandoned, so release restores the original slot. */
  cancelled?: boolean;
}

function ModuleFrameInner({ moduleId }: { moduleId: string }) {
  const module = useDeckModule(moduleId);
  const deck = useActiveDeck();
  const actions = useDeckActions();
  const ui = useDeskUI();
  const zoom = ui.zoom;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [offset, setOffset] = useState({ dx: 0, dy: 0, dw: 0, dh: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const nodeRef = useRef<HTMLElement>(null);

  const startDrag = useCallback(
    (event: React.PointerEvent, mode: DragState['mode']) => {
      if (!module || module.locked) return;
      event.preventDefault();
      event.stopPropagation();
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      actions.raiseModule(module.id);
      ui.select(module.id);
      const surface = (event.currentTarget as HTMLElement).closest('.desk');
      setDrag({
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollLeft: surface?.scrollLeft ?? 0,
        startScrollTop: surface?.scrollTop ?? 0,
        originX: module.position.x,
        originY: module.position.y,
        originW: module.size.width,
        originH: module.size.height,
        mode,
      });
    },
    [module, actions, ui],
  );

  // Neighbours are the snap and swap candidates; recomputed per gesture, not
  // per pointer event.
  const neighbours = useMemo(
    () => deck.modules.filter((m) => m.id !== moduleId).map((m) => ({ id: m.id, rect: moduleRect(m), locked: m.locked })),
    [deck.modules, moduleId],
  );

  /** Latest pointer position, so a scroll can recompute without a pointer event. */
  const pointerRef = useRef({ x: 0, y: 0 });

  const applyDrag = useCallback(
    (clientX: number, clientY: number) => {
      if (!drag || !module || drag.cancelled) return;
      const surface = nodeRef.current?.closest('.desk');
      // Scrolling the desk moves the canvas under a stationary pointer, so the
      // scroll delta counts as movement too.
      const scrollDx = (surface?.scrollLeft ?? 0) - drag.startScrollLeft;
      const scrollDy = (surface?.scrollTop ?? 0) - drag.startScrollTop;
      // Pointer and scroll deltas are screen pixels; module positions are canvas
      // pixels. At 50% zoom the pointer has to travel twice as far to move a
      // module the same distance, so every delta is divided by the scale.
      const dx = (clientX - drag.startX + scrollDx) / zoom;
      const dy = (clientY - drag.startY + scrollDy) / zoom;

      if (drag.mode !== 'move') {
        setOffset({
          dx: 0,
          dy: 0,
          dw: drag.mode === 'resize-s' ? 0 : dx,
          dh: drag.mode === 'resize-e' ? 0 : dy,
        });
        return;
      }

      // Track locally while dragging and commit once on release, so the store
      // (and persistence, and undo) sees one update rather than one per event.
      setOffset({ dx, dy, dw: 0, dh: 0 });

      const raw = {
        x: Math.max(0, drag.originX + dx),
        y: Math.max(0, drag.originY + dy),
        width: module.size.width,
        height: module.collapsed ? HEADER_HEIGHT : module.size.height,
      };
      const snapped = computeSnap(raw, neighbours.map((n) => n.rect), {
        grid: deck.settings.gridSize,
        snapToGrid: deck.settings.snapToGrid,
      });
      const swapTargetId = findSwapTarget(raw, neighbours);

      ui.setDragPreview({
        moduleId: module.id,
        rect: { x: snapped.x, y: snapped.y, width: raw.width, height: raw.height },
        guides: swapTargetId ? [] : snapped.guides,
        swapTargetId,
      });
    },
    [drag, module, neighbours, deck.settings.gridSize, deck.settings.snapToGrid, ui, zoom],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      pointerRef.current = { x: event.clientX, y: event.clientY };
      applyDrag(event.clientX, event.clientY);
    },
    [drag, applyDrag],
  );

  // Auto-scroll fires without pointer movement; keep the module under the cursor.
  useEffect(() => {
    if (!drag || drag.mode !== 'move') return;
    const surface = nodeRef.current?.closest('.desk');
    if (!surface) return;
    const onScroll = () => applyDrag(pointerRef.current.x, pointerRef.current.y);
    surface.addEventListener('scroll', onScroll);
    return () => surface.removeEventListener('scroll', onScroll);
  }, [drag, applyDrag]);

  const endDrag = useCallback(
    (event: React.PointerEvent) => {
      if (!drag || !module || event.pointerId !== drag.pointerId) return;
      const preview = ui.dragPreview;
      ui.setDragPreview(null);
      setDrag(null);
      setOffset({ dx: 0, dy: 0, dw: 0, dh: 0 });
      // A cancelled gesture (Escape, pointer cancel) leaves the module exactly
      // where it started.
      if (drag.cancelled) return;

      if (drag.mode === 'move') {
        if (preview?.swapTargetId) {
          actions.swapModules(module.id, preview.swapTargetId);
          return;
        }
        const target = preview?.rect ?? {
          x: drag.originX + offset.dx,
          y: drag.originY + offset.dy,
        };
        // Guide-aligned drops are exact; everything else goes through the grid.
        actions.moveModule(module.id, { x: target.x, y: target.y }, true);
        return;
      }

      actions.resizeModule(module.id, {
        width: snapToGrid(drag.originW + offset.dw, deck.settings.gridSize, deck.settings.snapToGrid),
        height: snapToGrid(drag.originH + offset.dh, deck.settings.gridSize, deck.settings.snapToGrid),
      });
    },
    [drag, module, actions, offset, ui, deck.settings.gridSize, deck.settings.snapToGrid],
  );

  // Escape abandons an in-flight drag; the pointer is still down, so the
  // gesture is marked and the release below restores the original position.
  useEffect(() => {
    if (!drag) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setDrag((prev) => (prev ? { ...prev, cancelled: true } : prev));
      setOffset({ dx: 0, dy: 0, dw: 0, dh: 0 });
      ui.setDragPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag, ui]);

  if (!module) return null;
  const definition = getModuleDefinition(module.type);
  if (!definition) {
    return (
      <section
        className="module"
        style={{ left: module.position.x, top: module.position.y, width: module.size.width, height: 90 }}
      >
        <div className="module-head">
          <span className="module-title">UNKNOWN MODULE</span>
        </div>
        <div className="module-body">
          <span className="faint">“{module.type}” is not registered in this build.</span>
        </div>
      </section>
    );
  }

  const LazyComponent = getModuleComponent(module.type);
  const fullscreen = ui.fullscreenModuleId === module.id;
  const menuEntries: MenuEntry[] = [
    { id: 'settings', label: 'Settings & links', icon: '⚙', onSelect: () => setMenuOpen((prev) => !prev) },
    { id: 'duplicate', label: 'Duplicate', icon: '⧉', onSelect: () => actions.duplicateModule(module.id) },
    { id: 'sep1', kind: 'separator' },
    {
      id: 'lock',
      label: module.locked ? 'Unlock position' : 'Lock position',
      checked: module.locked,
      keepOpen: true,
      onSelect: () => actions.patchModule(module.id, { locked: !module.locked }),
    },
    {
      id: 'pin',
      label: 'Pinned',
      checked: module.pinned,
      keepOpen: true,
      onSelect: () => actions.patchModule(module.id, { pinned: !module.pinned }),
    },
    {
      id: 'collapse',
      label: 'Collapsed',
      checked: module.collapsed,
      keepOpen: true,
      onSelect: () => actions.patchModule(module.id, { collapsed: !module.collapsed }),
    },
    {
      id: 'fullscreen',
      label: 'Full screen',
      checked: fullscreen,
      hint: '□',
      onSelect: () => ui.setFullscreen(fullscreen ? null : module.id),
    },
    { id: 'sep2', kind: 'separator' },
    { id: 'reset', label: 'Reset size', icon: '⤢', onSelect: () => actions.resizeModule(module.id, definition.defaultSize) },
    { id: 'remove', label: 'Remove module', icon: '×', tone: 'danger', onSelect: () => actions.removeModule(module.id) },
  ];
  const linkCount = incomingLinks(deck, module.id).length;
  const dimmed = Boolean(ui.draft && ui.draft.moduleId !== module.id && !definitionHasCompatiblePort(definition, ui.draft.type, ui.draft.side));

  return (
    <section
      ref={nodeRef}
      className="module"
      data-selected={ui.selectedModuleId === module.id}
      data-dragging={drag?.mode === 'move'}
      data-collapsed={module.collapsed}
      data-locked={module.locked}
      data-fullscreen={fullscreen}
      data-linking-dim={dimmed}
      data-swap-target={ui.dragPreview?.swapTargetId === module.id ? 'true' : undefined}
      data-mobile-size={module.mobileSize}
      style={{
        left: module.position.x + offset.dx,
        top: module.position.y + offset.dy,
        width: Math.max(definition.minSize.width, module.size.width + offset.dw),
        height: module.collapsed ? HEADER_HEIGHT : Math.max(definition.minSize.height, module.size.height + offset.dh),
      }}
      onPointerDown={() => ui.select(module.id)}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      aria-label={`${module.name} module`}
    >
      <header className="module-head" onPointerDown={(event) => startDrag(event, 'move')}>
        <span className="dot" data-tone={definition.permission === 'EXECUTION_CAPABLE' ? 'warning' : 'accent'} />
        <span aria-hidden style={{ color: 'var(--text-muted)' }}>{definition.icon}</span>
        <span className="module-title grow">{module.name}</span>
        {linkCount > 0 ? (
          <span className="chip" title={`${linkCount} inbound link${linkCount === 1 ? '' : 's'}`}>
            ⇢{linkCount}
          </span>
        ) : null}
        {module.locked ? <span className="chip" data-tone="warning">LOCK</span> : null}
        <div className="module-head-actions" onPointerDown={(event) => event.stopPropagation()}>
          <Menu
            label={`${module.name} actions`}
            align="end"
            entries={menuEntries}
            trigger={(props) => (
              <IconButton label="Module menu" data-active={menuOpen ? 'true' : undefined} {...props}>
                ⋮
              </IconButton>
            )}
          />
          <IconButton
            label={module.collapsed ? 'Expand module' : 'Collapse module'}
            onClick={() => actions.patchModule(module.id, { collapsed: !module.collapsed })}
          >
            {module.collapsed ? '▸' : '▾'}
          </IconButton>
          <IconButton
            label={fullscreen ? 'Exit full screen' : 'Full screen'}
            active={fullscreen}
            onClick={() => ui.setFullscreen(fullscreen ? null : module.id)}
          >
            □
          </IconButton>
          <IconButton label="Remove module" tone="danger" onClick={() => actions.removeModule(module.id)}>
            ×
          </IconButton>
        </div>
      </header>

      {!module.collapsed ? (
        <>
          {menuOpen ? (
            <ModuleSettings module={module} definition={definition} onClose={() => setMenuOpen(false)} />
          ) : null}
          <div className="module-body" data-flush={definition.flush ? 'true' : undefined}>
            <ModuleErrorBoundary name={module.name}>
              <Suspense fallback={<div className="skeleton" style={{ width: '60%' }} />}>
                {LazyComponent ? <LazyComponent module={module} /> : <span className="faint">NO RENDERER</span>}
              </Suspense>
            </ModuleErrorBoundary>
          </div>
        </>
      ) : null}

      <div className="ports" data-side="in" style={{ pointerEvents: 'none' }}>
        <ModulePorts module={module} definition={definition} side="in" />
      </div>
      <div className="ports" data-side="out" style={{ pointerEvents: 'none' }}>
        <ModulePorts module={module} definition={definition} side="out" />
      </div>

      {!module.collapsed && !module.locked ? (
        <>
          <div className="resize-edge" data-edge="e" onPointerDown={(event) => startDrag(event, 'resize-e')} />
          <div className="resize-edge" data-edge="s" onPointerDown={(event) => startDrag(event, 'resize-s')} />
          <div className="resize-handle" onPointerDown={(event) => startDrag(event, 'resize-se')} />
        </>
      ) : null}
    </section>
  );
}

/** Can this module accept (or feed) the link currently being dragged? */
function definitionHasCompatiblePort(
  definition: { inputs: { type: PortDataType }[]; outputs: { type: PortDataType }[] },
  draftType: PortDataType,
  draftSide: 'in' | 'out',
): boolean {
  return draftSide === 'out'
    ? definition.inputs.some((port) => canConnect(draftType, port.type))
    : definition.outputs.some((port) => canConnect(port.type, draftType));
}

export const ModuleFrame = memo(ModuleFrameInner);
