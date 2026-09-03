import { useCallback, useMemo, useRef } from 'react';
import type { Deck } from '../../core/modules/types';
import { moduleHeight } from './geometry';
import type { Rect } from './zoom';

const MAP_WIDTH = 148;
const MAP_HEIGHT = 96;

/**
 * The whole deck at a glance, with the on-screen area drawn on top.
 *
 * On a deck that outgrows one screen, scrollbars tell you how far along you are
 * but not what you are looking at. This shows both, and clicking somewhere is
 * the fastest way to get there.
 */
export function Minimap({
  deck,
  canvas,
  visible,
  onJump,
  selectedModuleId,
}: {
  deck: Deck;
  canvas: { width: number; height: number };
  /** Currently on-screen area, in canvas coordinates. */
  visible: Rect;
  /** Canvas point to centre the viewport on. */
  onJump: (point: { x: number; y: number }) => void;
  selectedModuleId: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // One scale for both axes keeps the deck's proportions readable; the map is
  // letterboxed inside its box rather than stretched to fill it.
  const scale = useMemo(
    () => Math.min(MAP_WIDTH / Math.max(1, canvas.width), MAP_HEIGHT / Math.max(1, canvas.height)),
    [canvas.width, canvas.height],
  );

  const jumpTo = useCallback(
    (clientX: number, clientY: number) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      onJump({ x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale });
    },
    [onJump, scale],
  );

  if (deck.modules.length === 0) return null;

  return (
    <div
      ref={ref}
      className="minimap"
      role="presentation"
      style={{ width: canvas.width * scale, height: canvas.height * scale }}
      onPointerDown={(event) => {
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        jumpTo(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 1) return;
        jumpTo(event.clientX, event.clientY);
      }}
      title="Click or drag to move around the deck"
    >
      {deck.modules.map((module) => (
        <span
          key={module.id}
          className="minimap-module"
          data-selected={module.id === selectedModuleId ? 'true' : undefined}
          style={{
            left: module.position.x * scale,
            top: module.position.y * scale,
            width: Math.max(2, module.size.width * scale),
            height: Math.max(2, moduleHeight(module) * scale),
          }}
        />
      ))}
      <span
        className="minimap-viewport"
        style={{
          left: visible.x * scale,
          top: visible.y * scale,
          width: Math.min(canvas.width - visible.x, visible.width) * scale,
          height: Math.min(canvas.height - visible.y, visible.height) * scale,
        }}
      />
    </div>
  );
}
