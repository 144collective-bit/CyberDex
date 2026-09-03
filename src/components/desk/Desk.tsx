import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveDeck, useDeckActions, useDeckModuleIds, useDeskUI } from '../../state/deck';
import { useSystem } from '../../state/system';
import { DragOverlay } from './DragOverlay';
import { LinkLayer } from './LinkLayer';
import { ModuleFrame } from './ModuleFrame';
import type { Point } from './geometry';
import { Button } from '../ui/Button';

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
  const [draftPoint, setDraftPoint] = useState<Point | null>(null);

  // Canvas grows to hold the furthest module, with room to keep building.
  const canvasSize = useMemo(() => {
    const maxX = deck.modules.reduce((acc, m) => Math.max(acc, m.position.x + m.size.width), 1200);
    const maxY = deck.modules.reduce((acc, m) => Math.max(acc, m.position.y + m.size.height), 800);
    return { width: maxX + 600, height: maxY + 400 };
  }, [deck.modules]);

  const toCanvas = useCallback((clientX: number, clientY: number): Point | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

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
    const surface = canvasRef.current?.parentElement;
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

      if (!typing && (event.key === 'l' || event.key === 'L') && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        ui.toggleLinkMode();
        return;
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
  }, [ui, actions, deck.modules, deck.settings.gridSize]);

  return (
    <div
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
        {ui.linkMode ? (
          <span className="desk-tools-hint">
            Drag from an output port to a compatible input to connect two modules.
          </span>
        ) : null}
      </div>

      <div
        ref={canvasRef}
        className="desk-canvas"
        style={{ width: canvasSize.width, height: canvasSize.height }}
      >
        <LinkLayer deck={deck} draftPoint={draftPoint} />
        <DragOverlay />
        {moduleIds.map((id) => (
          <ModuleFrame key={id} moduleId={id} />
        ))}

        {moduleIds.length === 0 ? (
          <div className="empty" style={{ position: 'absolute', inset: 0 }}>
            <h5>EMPTY DECK</h5>
            <p>This deck has no modules yet. Add one to start building your terminal.</p>
            <Button variant="primary" onClick={onAddModule}>
              + ADD MODULE
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
