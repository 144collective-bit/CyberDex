import { useEffect, useMemo, useRef, useState } from 'react';
import { getModuleDefinition, listCategories, searchModuleDefinitions } from '../../core/modules/registry';
import type { ModuleCategory } from '../../core/modules/types';
import { hasModuleComponent } from '../../modules/components';
import { useActiveDeck, useDeckActions, useDeskUI } from '../../state/deck';
import { findFreePosition, viewportOrigin } from './placement';

const RECENT_KEY = 'cyberdex.recentModules';

function readRecent(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** Add-module surface: search, categories, recents, and a live port preview. */
export function ModuleLibrary({ onClose }: { onClose: () => void }) {
  const deck = useActiveDeck();
  const actions = useDeckActions();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ModuleCategory | 'ALL' | 'RECENT'>('ALL');
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const inputRef = useRef<HTMLInputElement>(null);
  const ui = useDeskUI();

  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo(() => {
    const all = searchModuleDefinitions(query).filter((def) => hasModuleComponent(def.type));
    if (category === 'ALL') return all;
    if (category === 'RECENT') return all.filter((def) => recent.includes(def.type));
    return all.filter((def) => def.category === category);
  }, [query, category, recent]);

  const add = (type: string) => {
    // Land the module where the user is looking, not at the bottom of a canvas
    // they would then have to go find.
    const definition = getModuleDefinition(type);
    const position = findFreePosition(
      deck.modules,
      viewportOrigin(),
      definition?.defaultSize ?? { width: 300, height: 220 },
    );
    actions.addModule(type, { position });
    ui.select(null);
    const next = [type, ...recent.filter((item) => item !== type)].slice(0, 8);
    setRecent(next);
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* storage optional */
    }
    onClose();
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="panel" style={{ width: 'min(940px, 100%)' }} role="dialog" aria-label="Module library">
        <div className="panel-head">
          <span className="panel-title">MODULE LIBRARY</span>
          <input
            ref={inputRef}
            className="input grow"
            placeholder="SEARCH MODULES…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="icon-btn" aria-label="Close library" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="row wrap" style={{ gap: 2, padding: 'var(--space-3) var(--space-5)', borderBottom: '1px solid var(--border)' }}>
          {(['ALL', 'RECENT', ...listCategories()] as const).map((item) => (
            <button
              key={item}
              type="button"
              className="btn"
              data-variant="ghost"
              data-active={category === item}
              onClick={() => setCategory(item as ModuleCategory | 'ALL' | 'RECENT')}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="panel-body">
          {results.length === 0 ? (
            <div className="empty">
              <h5>NO MODULES MATCH</h5>
              <p>Try a different term — “chart”, “wallet”, “swap”, “alert”.</p>
            </div>
          ) : (
            <div className="lib-grid">
              {results.map((def) => (
                <button key={def.type} type="button" className="lib-card" onClick={() => add(def.type)}>
                  <div className="spread">
                    <h4>
                      <span aria-hidden style={{ marginRight: 6 }}>{def.icon}</span>
                      {def.name}
                    </h4>
                    <span className="chip">{def.category}</span>
                  </div>
                  <p>{def.description}</p>
                  <div className="row wrap" style={{ gap: 2 }}>
                    {def.inputs.length ? (
                      <span className="chip" data-tone="info">
                        IN {def.inputs.length}
                      </span>
                    ) : null}
                    {def.outputs.length ? (
                      <span className="chip" data-tone="accent">
                        OUT {def.outputs.length}
                      </span>
                    ) : null}
                    {def.permission === 'EXECUTION_CAPABLE' ? (
                      <span className="chip" data-tone="warning">
                        EXECUTION
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="panel-foot">
          <span className="faint" style={{ marginRight: 'auto', fontSize: 'var(--text-3xs)' }}>
            {results.length} MODULES · v1 CATALOGUE
          </span>
          <button type="button" className="btn" onClick={onClose}>
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
