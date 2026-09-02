import { Component as ReactComponent, Suspense, memo, useCallback, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { getModuleDefinition } from '../../core/modules/registry';
import { canConnect } from '../../core/modules/ports';
import type { PortDataType } from '../../core/modules/ports';
import { getModuleComponent } from '../../modules/components';
import { useDeckActions, useDeckModule, useDeskUI } from '../../state/deck';
import { incomingLinks } from '../../core/graph/linkGraph';
import { useActiveDeck } from '../../state/deck';
import { ModulePorts } from './ModulePorts';
import { ModuleSettings } from './ModuleSettings';
import { HEADER_HEIGHT } from './geometry';

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
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            RELOAD MODULE
          </button>
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
  originX: number;
  originY: number;
  mode: 'move' | 'resize-se' | 'resize-e' | 'resize-s';
  originW: number;
  originH: number;
}

function ModuleFrameInner({ moduleId }: { moduleId: string }) {
  const module = useDeckModule(moduleId);
  const deck = useActiveDeck();
  const actions = useDeckActions();
  const ui = useDeskUI();
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
      setDrag({
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: module.position.x,
        originY: module.position.y,
        originW: module.size.width,
        originH: module.size.height,
        mode,
      });
    },
    [module, actions, ui],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      // Track locally while dragging; commit once on release so the store (and
      // persistence) sees one update rather than one per pointer event.
      setOffset(
        drag.mode === 'move'
          ? { dx, dy, dw: 0, dh: 0 }
          : {
              dx: 0,
              dy: 0,
              dw: drag.mode === 'resize-s' ? 0 : dx,
              dh: drag.mode === 'resize-e' ? 0 : dy,
            },
      );
    },
    [drag],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent) => {
      if (!drag || !module || event.pointerId !== drag.pointerId) return;
      if (drag.mode === 'move') {
        actions.moveModule(module.id, { x: drag.originX + offset.dx, y: drag.originY + offset.dy });
      } else {
        actions.resizeModule(module.id, {
          width: drag.originW + offset.dw,
          height: drag.originH + offset.dh,
        });
      }
      setDrag(null);
      setOffset({ dx: 0, dy: 0, dw: 0, dh: 0 });
    },
    [drag, module, actions, offset],
  );

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
          <button
            type="button"
            className="icon-btn"
            aria-label="Module settings"
            data-active={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            ⋮
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={module.collapsed ? 'Expand module' : 'Collapse module'}
            onClick={() => actions.patchModule(module.id, { collapsed: !module.collapsed })}
          >
            {module.collapsed ? '▸' : '▾'}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            onClick={() => ui.setFullscreen(fullscreen ? null : module.id)}
          >
            □
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Remove module"
            onClick={() => actions.removeModule(module.id)}
          >
            ×
          </button>
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
