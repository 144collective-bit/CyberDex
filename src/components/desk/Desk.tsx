import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveDeck, useDeckActions, useDeckModuleIds, useDeskUI } from '../../state/deck';
import { useSystem } from '../../state/system';
import { LinkLayer } from './LinkLayer';
import { ModuleFrame } from './ModuleFrame';
import type { Point } from './geometry';

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
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
  }, [ui, actions]);

  return (
    <div
      className="desk"
      data-dragging={Boolean(ui.draft)}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('desk-canvas')) {
          ui.select(null);
          ui.selectLink(null);
        }
      }}
    >
      <div
        ref={canvasRef}
        className="desk-canvas"
        style={{ width: canvasSize.width, height: canvasSize.height }}
      >
        <LinkLayer deck={deck} draftPoint={draftPoint} />
        {moduleIds.map((id) => (
          <ModuleFrame key={id} moduleId={id} />
        ))}

        {moduleIds.length === 0 ? (
          <div className="empty" style={{ position: 'absolute', inset: 0 }}>
            <h5>EMPTY DECK</h5>
            <p>This deck has no modules yet. Add one to start building your terminal.</p>
            <button type="button" className="btn" data-variant="primary" onClick={onAddModule}>
              + ADD MODULE
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
