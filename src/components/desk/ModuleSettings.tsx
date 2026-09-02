import { getModuleDefinition } from '../../core/modules/registry';
import type { ModuleDefinition, ModuleInstance } from '../../core/modules/types';
import { useActiveDeck, useDeckActions } from '../../state/deck';
import { incomingLinks, outgoingLinks } from '../../core/graph/linkGraph';

/**
 * Per-module settings drawer: identity, geometry, behaviour and — most
 * usefully — the module's live wiring, with one-click disconnect.
 */
export function ModuleSettings({
  module,
  definition,
  onClose,
}: {
  module: ModuleInstance;
  definition: ModuleDefinition;
  onClose: () => void;
}) {
  const deck = useActiveDeck();
  const actions = useDeckActions();
  const inbound = incomingLinks(deck, module.id);
  const outbound = outgoingLinks(deck, module.id);

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface-overlay)',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        maxHeight: '70%',
        overflow: 'auto',
      }}
    >
      <div className="spread">
        <span className="label">MODULE SETTINGS · v{definition.version}</span>
        <button type="button" className="icon-btn" aria-label="Close settings" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="col" style={{ gap: 2 }}>
        <span className="label">TITLE</span>
        <input
          className="input"
          value={module.name}
          onChange={(event) => actions.patchModule(module.id, { name: event.target.value })}
        />
      </div>

      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <div className="col grow" style={{ gap: 2 }}>
          <span className="label">WIDTH</span>
          <input
            className="input mono-num"
            type="number"
            value={module.size.width}
            onChange={(event) =>
              actions.resizeModule(module.id, { width: Number(event.target.value), height: module.size.height })
            }
          />
        </div>
        <div className="col grow" style={{ gap: 2 }}>
          <span className="label">HEIGHT</span>
          <input
            className="input mono-num"
            type="number"
            value={module.size.height}
            onChange={(event) =>
              actions.resizeModule(module.id, { width: module.size.width, height: Number(event.target.value) })
            }
          />
        </div>
        <div className="col" style={{ gap: 2, width: 96 }}>
          <span className="label">MOBILE</span>
          <select
            className="select"
            value={module.mobileSize ?? 'half'}
            onChange={(event) =>
              actions.patchModule(module.id, { mobileSize: event.target.value as ModuleInstance['mobileSize'] })
            }
          >
            <option value="compact">COMPACT</option>
            <option value="half">HALF</option>
            <option value="full">FULL</option>
          </select>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 'var(--space-2)' }}>
        <button
          type="button"
          className="btn"
          data-active={module.locked}
          onClick={() => actions.patchModule(module.id, { locked: !module.locked })}
        >
          {module.locked ? 'UNLOCK' : 'LOCK'}
        </button>
        <button
          type="button"
          className="btn"
          data-active={module.pinned}
          onClick={() => actions.patchModule(module.id, { pinned: !module.pinned })}
        >
          {module.pinned ? 'UNPIN' : 'PIN'}
        </button>
        <button type="button" className="btn" onClick={() => actions.duplicateModule(module.id)}>
          DUPLICATE
        </button>
        <button type="button" className="btn" data-variant="danger" onClick={() => actions.removeModule(module.id)}>
          REMOVE
        </button>
      </div>

      <div className="col" style={{ gap: 2 }}>
        <span className="label">INBOUND LINKS</span>
        {inbound.length === 0 ? <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>NONE</span> : null}
        {inbound.map((link) => {
          const source = deck.modules.find((m) => m.id === link.sourceModuleId);
          return (
            <div key={link.id} className="spread" style={{ fontSize: 'var(--text-3xs)' }}>
              <span className="truncate">
                {source?.name ?? 'UNKNOWN'} · {link.sourceOutput} → {link.targetInput}
              </span>
              <button type="button" className="icon-btn" aria-label="Disconnect" onClick={() => actions.disconnect(link.id)}>
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="col" style={{ gap: 2 }}>
        <span className="label">OUTBOUND LINKS</span>
        {outbound.length === 0 ? <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>NONE</span> : null}
        {outbound.map((link) => {
          const target = deck.modules.find((m) => m.id === link.targetModuleId);
          const targetDef = target ? getModuleDefinition(target.type) : undefined;
          return (
            <div key={link.id} className="spread" style={{ fontSize: 'var(--text-3xs)' }}>
              <span className="truncate">
                {link.sourceOutput} → {target?.name ?? 'UNKNOWN'} · {targetDef ? link.targetInput : link.targetInput}
              </span>
              <button type="button" className="icon-btn" aria-label="Disconnect" onClick={() => actions.disconnect(link.id)}>
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="col" style={{ gap: 2 }}>
        <span className="label">PORTS</span>
        <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>
          IN {definition.inputs.map((p) => `${p.id}:${p.type}`).join(' · ') || '—'}
        </span>
        <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>
          OUT {definition.outputs.map((p) => `${p.id}:${p.type}`).join(' · ') || '—'}
        </span>
      </div>
    </div>
  );
}
