import type { ModuleDefinition, ModuleInstance } from '../../core/modules/types';
import type { PortSpec } from '../../core/modules/ports';
import { canConnect } from '../../core/modules/ports';
import { useDeckActions, useDeckConnections, useDeskUI } from '../../state/deck';
import { moduleHeight, portOffsetY, PORT_SIZE } from './geometry';

/**
 * Connection ports.
 *
 * While a link is being dragged, compatible ports light up and incompatible
 * ones fade out — the port type system, made visible.
 */
export function ModulePorts({
  module,
  definition,
  side,
}: {
  module: ModuleInstance;
  definition: ModuleDefinition;
  side: 'in' | 'out';
}) {
  const ports: PortSpec[] = side === 'in' ? definition.inputs : definition.outputs;
  const { draft, beginLink, endLink } = useDeskUI();
  const { connect } = useDeckActions();
  const connections = useDeckConnections();
  if (!ports.length) return null;

  const height = moduleHeight(module);
  const dragging = draft && draft.moduleId !== module.id && draft.side !== side;

  return (
    <>
      {ports.map((port, index) => {
        const connected = connections.some((c) =>
          side === 'in'
            ? c.targetModuleId === module.id && c.targetInput === port.id
            : c.sourceModuleId === module.id && c.sourceOutput === port.id,
        );

        const compatible = dragging
          ? draft!.side === 'out'
            ? canConnect(draft!.type, port.type)
            : canConnect(port.type, draft!.type)
          : undefined;

        return (
          <button
            key={port.id}
            type="button"
            className="port"
            data-side={side}
            data-connected={connected}
            data-compatible={compatible === true}
            data-incompatible={compatible === false}
            aria-label={`${side === 'in' ? 'Input' : 'Output'} ${port.label} carrying ${port.type}`}
            style={{ position: 'absolute', top: portOffsetY(index, ports.length, height) - PORT_SIZE / 2 }}
            onPointerDown={(event) => {
              event.stopPropagation();
              beginLink({
                moduleId: module.id,
                portId: port.id,
                side,
                type: port.type,
                x: event.clientX,
                y: event.clientY,
              });
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              if (!draft || draft.moduleId === module.id || draft.side === side) {
                endLink();
                return;
              }
              if (draft.side === 'out') {
                connect({ moduleId: draft.moduleId, portId: draft.portId }, { moduleId: module.id, portId: port.id });
              } else {
                connect({ moduleId: module.id, portId: port.id }, { moduleId: draft.moduleId, portId: draft.portId });
              }
              endLink();
            }}
          >
            <span className="port-tip">
              {port.label} · {port.type}
            </span>
          </button>
        );
      })}
    </>
  );
}
