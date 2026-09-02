import { getModuleDefinition } from '../../core/modules/registry';
import type { Deck } from '../../core/modules/types';
import { useDeckActions, useDeskUI } from '../../state/deck';
import { linkPath, portPoint } from './geometry';
import type { Point } from './geometry';

/**
 * Draws the data lines.
 *
 * Idle links stay quiet; the selected one brightens and shows an animated flow
 * so the deck reads as a circuit without becoming a light show.
 */
export function LinkLayer({ deck, draftPoint }: { deck: Deck; draftPoint: Point | null }) {
  const ui = useDeskUI();
  const actions = useDeckActions();
  if (!deck.settings.showLinks) return null;

  const draftOrigin = (() => {
    if (!ui.draft) return null;
    const module = deck.modules.find((m) => m.id === ui.draft!.moduleId);
    if (!module) return null;
    return portPoint(module, getModuleDefinition(module.type), ui.draft.portId, ui.draft.side);
  })();

  return (
    <svg className="link-layer" aria-hidden>
      {deck.connections.map((connection) => {
        const source = deck.modules.find((m) => m.id === connection.sourceModuleId);
        const target = deck.modules.find((m) => m.id === connection.targetModuleId);
        if (!source || !target) return null;
        const from = portPoint(source, getModuleDefinition(source.type), connection.sourceOutput, 'out');
        const to = portPoint(target, getModuleDefinition(target.type), connection.targetInput, 'in');
        if (!from || !to) return null;
        const path = linkPath(from, to);
        const selected = ui.selectedLinkId === connection.id;
        const active =
          selected || ui.selectedModuleId === connection.sourceModuleId || ui.selectedModuleId === connection.targetModuleId;

        return (
          <g key={connection.id}>
            <path
              className="link-hit"
              d={path}
              onClick={() => ui.selectLink(connection.id)}
              onDoubleClick={() => actions.disconnect(connection.id)}
              style={{ pointerEvents: 'stroke' }}
            />
            <path className="link-path" d={path} data-selected={selected} />
            {active ? <path className="link-flow" d={path} /> : null}
          </g>
        );
      })}

      {draftOrigin && draftPoint ? (
        <path
          className="link-draft"
          d={
            ui.draft?.side === 'out'
              ? linkPath(draftOrigin, draftPoint)
              : linkPath(draftPoint, draftOrigin)
          }
        />
      ) : null}
    </svg>
  );
}
