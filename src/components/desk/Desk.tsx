import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveDeck, useDeckActions, useDeckModuleIds, useDeskUI } from '../../state/deck';
import { useSystem } from '../../state/system';
import { DragOverlay } from './DragOverlay';
import { LinkLayer } from './LinkLayer';
import { ModuleFrame } from './ModuleFrame';
import { getModuleDefinition } from '../../core/modules/registry';
import type { Point } from './geometry';
import { Button } from '../ui/Button';
import { Minimap } from './Minimap';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  contentBounds,
  fitZoom,
  nextZoom,
  scrollForZoomAtPoint,
  scrollToRect,
  visibleRect,
} from './zoom';

/**
 * The workspace surface.
 *
 * Modules are absolutely positioned on a large scrollable canvas; the desk
 * itself only re-renders when the set of modules changes, because each frame
 * subscribes to its own slice of the deck.
 */
export function Desk({ onAddModule }: { onAddModule: () => void }) {
  const deck = useActiveDeck();
  const moduleIds = useDeckModuleIds();
  const actions = useDeckActions();
  const ui = useDeskUI();
  const system = useSystem();
  const canvasRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [draftPoint, setDraftPoint] = useState<Point | null>(null);
  const zoom = ui.zoom;
  // Scroll is DOM state, not React state, but the minimap has to redraw when it
  // changes — so it is mirrored here and updated from the scroll handler.
  const [view, setView] = useState({ width: 0, height: 0, scrollLeft: 0, scrollTop: 0 });
  const [jumpOpen, setJumpOpen] = useState(false);

  // Canvas grows to hold the furthest module, with room to keep building.
  const canvasSize = useMemo(() => {
    const maxX = deck.modules.reduce((acc, m) => Math.max(acc, m.position.x + m.size.width), 1200);
    const maxY = deck.modules.reduce((acc, m) => Math.max(acc, m.position.y + m.size.height), 800);
    return { width: maxX + 600, height: maxY + 400 };
  }, [deck.modules]);

  // The canvas element carries the scale, so its bounding rect is in screen
  // pixels: dividing by the zoom converts a cursor position to canvas space.
  const toCanvas = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
    },
    [zoom],
  );

  const readView = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return null;
    return {
      width: surface.clientWidth,
      height: surface.clientHeight,
      scrollLeft: surface.scrollLeft,
      scrollTop: surface.scrollTop,
    };
  }, []);

  // Keep the mirrored viewport in step with scrolling and resizing.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const sync = () => {
      const next = readView();
      if (next) setView(next);
    };
    sync();
    surface.addEventListener('scroll', sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(surface);
    return () => {
      surface.removeEventListener('scroll', sync);
      observer.disconnect();
    };
  }, [readView]);

  /** Change zoom while holding a screen point still. Defaults to the centre. */
  const zoomTo = useCallback(
    (next: number, anchor?: { x: number; y: number }) => {
      const surface = surfaceRef.current;
      const current = readView();
      if (!surface || !current) {
        ui.setZoom(next);
        return;
      }
      const point = anchor ?? { x: current.width / 2, y: current.height / 2 };
      const scroll = scrollForZoomAtPoint(current, point, zoom, next, canvasSize);
      ui.setZoom(next);
      // After the scale lands, not before, or the scroll is clamped against the
      // old canvas size.
      requestAnimationFrame(() => {
        surface.scrollLeft = scroll.scrollLeft;
        surface.scrollTop = scroll.scrollTop;
      });
    },
    [ui, zoom, canvasSize, readView],
  );

  /** Centre the viewport on a canvas point, without changing the zoom. */
  const centreOn = useCallback(
    (point: { x: number; y: number }) => {
      const surface = surfaceRef.current;
      const current = readView();
      if (!surface || !current) return;
      const scroll = scrollToRect(
        { x: point.x, y: point.y, width: 0, height: 0 },
        current,
        zoom,
        canvasSize,
      );
      surface.scrollLeft = scroll.scrollLeft;
      surface.scrollTop = scroll.scrollTop;
    },
    [zoom, canvasSize, readView],
  );

  const fitToView = useCallback(() => {
    const bounds = contentBounds(deck.modules);
    const current = readView();
    const surface = surfaceRef.current;
    if (!bounds || !current || !surface) return;
    const next = fitZoom(bounds, current);
    const scroll = scrollToRect(bounds, current, next, canvasSize);
    ui.setZoom(next);
    requestAnimationFrame(() => {
      surface.scrollLeft = scroll.scrollLeft;
      surface.scrollTop = scroll.scrollTop;
    });
  }, [deck.modules, ui, canvasSize, readView]);

  const jumpToModule = useCallback(
    (moduleId: string) => {
      const module = deck.modules.find((m) => m.id === moduleId);
      if (!module) return;
      centreOn({
        x: module.position.x + module.size.width / 2,
        y: module.position.y + module.size.height / 2,
      });
      ui.select(moduleId);
      setJumpOpen(false);
    },
    [deck.modules, centreOn, ui],
  );

  // A link drag is tracked at the desk level so the wire follows the cursor
  // even when it is over empty canvas.
  useEffect(() => {
    if (!ui.draft) {
      setDraftPoint(null);
      return;
    }
    const onMove = (event: PointerEvent) => setDraftPoint(toCanvas(event.clientX, event.clientY));
    const onUp = () => {
      ui.endLink();
      setDraftPoint(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [ui, toCanvas]);

  // Surface link rejections (type mismatch, loops) as a notification rather
  // than silently doing nothing.
  useEffect(
    () =>
      system.workspace.subscribe(() => {
        const error = system.workspace.getState().lastError;
        if (!error) return;
        system.notifications.push({ kind: 'warning', title: 'LINK REJECTED', detail: error });
        system.workspace.dispatch({ type: 'ERROR/CLEAR' });
      }),
    [system],
  );

  // Dragging toward the edge of the viewport scrolls the desk, so a module can
  // be moved somewhere that is not currently on screen.
  const preview = ui.dragPreview;
  useEffect(() => {
    if (!preview) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    let frame = 0;
    let pointer = { x: 0, y: 0 };
    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    const step = () => {
      const rect = surface.getBoundingClientRect();
      const margin = 64;
      const speed = 16;
      let dx = 0;
      let dy = 0;
      if (pointer.x > 0) {
        if (pointer.x - rect.left < margin) dx = -speed;
        else if (rect.right - pointer.x < margin) dx = speed;
        if (pointer.y - rect.top < margin) dy = -speed;
        else if (rect.bottom - pointer.y < margin) dy = speed;
      }
      if (dx || dy) surface.scrollBy(dx, dy);
      frame = requestAnimationFrame(step);
    };
    window.addEventListener('pointermove', onMove);
    frame = requestAnimationFrame(step);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, [preview]);

  // Ctrl/⌘ + wheel zooms about the cursor, the gesture every canvas tool uses.
  // Registered non-passive because the browser's own page zoom has to be
  // prevented; a plain wheel still scrolls the deck.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      zoomTo(nextZoom(zoom, event.deltaY < 0 ? 1 : -1), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, [zoom, zoomTo]);

  // Middle-button drag pans. Modules and ports own the left button, so this is
  // the one gesture that can grab the canvas itself from anywhere.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let panning: { x: number; y: number; scrollLeft: number; scrollTop: number } | null = null;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      panning = {
        x: event.clientX,
        y: event.clientY,
        scrollLeft: surface.scrollLeft,
        scrollTop: surface.scrollTop,
      };
      surface.setPointerCapture(event.pointerId);
      surface.dataset.panning = 'true';
    };
    const onMove = (event: PointerEvent) => {
      if (!panning) return;
      surface.scrollLeft = panning.scrollLeft - (event.clientX - panning.x);
      surface.scrollTop = panning.scrollTop - (event.clientY - panning.y);
    };
    const onUp = () => {
      panning = null;
      delete surface.dataset.panning;
    };
    surface.addEventListener('pointerdown', onDown);
    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerup', onUp);
    surface.addEventListener('pointercancel', onUp);
    return () => {
      surface.removeEventListener('pointerdown', onDown);
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerup', onUp);
      surface.removeEventListener('pointercancel', onUp);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

      // Arrow keys nudge the selected module: one grid step, or one pixel with
      // Shift. Deck editing should never require a mouse.
      if (!typing && ui.selectedModuleId && event.key.startsWith('Arrow')) {
        const module = deck.modules.find((m) => m.id === ui.selectedModuleId);
        if (module && !module.locked) {
          event.preventDefault();
          const step = event.shiftKey ? 1 : deck.settings.gridSize;
          const delta = {
            ArrowLeft: { x: -step, y: 0 },
            ArrowRight: { x: step, y: 0 },
            ArrowUp: { x: 0, y: -step },
            ArrowDown: { x: 0, y: step },
          }[event.key];
          if (delta) {
            actions.moveModule(
              module.id,
              { x: module.position.x + delta.x, y: module.position.y + delta.y },
              true,
            );
          }
          return;
        }
      }

      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.key === 'l' || event.key === 'L') {
          event.preventDefault();
          ui.toggleLinkMode();
          return;
        }
        if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          zoomTo(nextZoom(zoom, 1));
          return;
        }
        if (event.key === '-' || event.key === '_') {
          event.preventDefault();
          zoomTo(nextZoom(zoom, -1));
          return;
        }
        if (event.key === '0') {
          event.preventDefault();
          zoomTo(1);
          return;
        }
        if (event.key === 'f' || event.key === 'F') {
          event.preventDefault();
          fitToView();
          return;
        }
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (typing) return;
      if (ui.selectedLinkId) {
        actions.disconnect(ui.selectedLinkId);
        ui.selectLink(null);
      } else if (ui.selectedModuleId) {
        actions.removeModule(ui.selectedModuleId);
        ui.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui, actions, deck.modules, deck.settings.gridSize, zoom, zoomTo, fitToView]);

  const visible = visibleRect(view, zoom);
  const zoomPct = Math.round(zoom * 100);

  return (
    <div
      ref={surfaceRef}
      className="desk"
      data-dragging={Boolean(ui.draft)}
      data-link-mode={ui.linkMode ? 'true' : undefined}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('desk-canvas')) {
          ui.select(null);
          ui.selectLink(null);
        }
      }}
    >
      <div className="desk-tools">
        <button
          type="button"
          className="btn"
          data-variant={ui.linkMode ? 'primary' : 'default'}
          data-active={ui.linkMode}
          onClick={ui.toggleLinkMode}
          title="Show every connection port (L)"
        >
          ⧉ LINK MODE <span className="kbd">L</span>
        </button>

        <div className="desk-zoom" role="group" aria-label="Canvas zoom">
          <button
            type="button"
            className="btn"
            onClick={() => zoomTo(nextZoom(zoom, -1))}
            disabled={zoom <= ZOOM_MIN + 1e-6}
            title="Zoom out (−)"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="btn desk-zoom-value"
            onClick={() => zoomTo(1)}
            title="Reset to 100% (0)"
          >
            {zoomPct}%
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => zoomTo(nextZoom(zoom, 1))}
            disabled={zoom >= ZOOM_MAX - 1e-6}
            title="Zoom in (+)"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="btn"
            onClick={fitToView}
            disabled={deck.modules.length === 0}
            title="Fit the whole deck on screen (F)"
          >
            ⤢ FIT
          </button>
        </div>

        <div className="desk-jump">
          <button
            type="button"
            className="btn"
            aria-haspopup="listbox"
            aria-expanded={jumpOpen}
            disabled={deck.modules.length === 0}
            onClick={() => setJumpOpen((prev) => !prev)}
            title="Scroll to a module"
          >
            ⌖ GO TO <span aria-hidden style={{ opacity: 0.6 }}>▾</span>
          </button>
          {jumpOpen ? (
            <div
              role="listbox"
              className="desk-jump-list"
              onMouseLeave={() => setJumpOpen(false)}
            >
              {deck.modules.map((module) => {
                const definition = getModuleDefinition(module.type);
                return (
                  <button
                    key={module.id}
                    type="button"
                    role="option"
                    aria-selected={module.id === ui.selectedModuleId}
                    className="menu-item"
                    onClick={() => jumpToModule(module.id)}
                  >
                    <span aria-hidden>{definition?.icon ?? '▪'}</span>
                    <span className="grow truncate">{module.name || definition?.name || module.type}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {ui.linkMode ? (
          <span className="desk-tools-hint">
            Drag from an output port to a compatible input to connect two modules.
          </span>
        ) : null}
      </div>

      <div
        className="desk-stage"
        style={{ width: canvasSize.width * zoom, height: canvasSize.height * zoom }}
      >
        <div
          ref={canvasRef}
          className="desk-canvas"
          style={{
            width: canvasSize.width,
            height: canvasSize.height,
            transform: zoom === 1 ? undefined : `scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <LinkLayer deck={deck} draftPoint={draftPoint} />
          <DragOverlay />
          {moduleIds.map((id) => (
            <ModuleFrame key={id} moduleId={id} />
          ))}
        </div>
      </div>

      {moduleIds.length === 0 ? (
        <div className="empty desk-empty">
          <h5>EMPTY DECK</h5>
          <p>This deck has no modules yet. Add one to start building your terminal.</p>
          <Button variant="primary" onClick={onAddModule}>
            + ADD MODULE
          </Button>
        </div>
      ) : (
        <Minimap
          deck={deck}
          canvas={canvasSize}
          visible={visible}
          onJump={centreOn}
          selectedModuleId={ui.selectedModuleId}
        />
      )}
    </div>
  );
}
