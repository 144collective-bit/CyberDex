import { useDeskUI } from '../../state/deck';

/**
 * What the desk shows while a module is being dragged: the slot it will land
 * in, the alignment guides that decided it, and — when the drop would exchange
 * two modules — a clear SWAP marker instead of a landing slot.
 */
export function DragOverlay() {
  const { dragPreview } = useDeskUI();
  if (!dragPreview) return null;

  return (
    <>
      {dragPreview.guides.map((guide, index) => (
        <div
          key={`${guide.orientation}-${guide.position}-${index}`}
          className="align-guide"
          data-orientation={guide.orientation}
          style={
            guide.orientation === 'v'
              ? { left: guide.position, top: guide.from, height: Math.max(1, guide.to - guide.from) }
              : { top: guide.position, left: guide.from, width: Math.max(1, guide.to - guide.from) }
          }
        />
      ))}

      <div
        className="drop-slot"
        data-swap={dragPreview.swapTargetId ? 'true' : undefined}
        style={{
          left: dragPreview.rect.x,
          top: dragPreview.rect.y,
          width: dragPreview.rect.width,
          height: dragPreview.rect.height,
        }}
      >
        {dragPreview.swapTargetId ? <span className="drop-slot-label">SWAP</span> : null}
      </div>
    </>
  );
}
