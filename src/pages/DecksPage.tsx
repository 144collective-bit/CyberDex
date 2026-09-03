import { useRef, useState } from 'react';
import { createDeck } from '../core/deck/deckReducer';
import { exportDeck, importDeck, serializeDeck } from '../core/deck/schema';
import { DECK_TEMPLATES, instantiateTemplate } from '../modules/templates';
import { useActiveDeck, useDeckDispatch, useWorkspaceState } from '../state/deck';
import { useSystem } from '../state/system';
import { formatRelative } from '../utils/format';
import { Button } from '../components/ui/Button';

/** Deck manager: create, template, duplicate, rename, export, import, delete. */
export function DecksPage({ onOpenDesk }: { onOpenDesk: () => void }) {
  const system = useSystem();
  const state = useWorkspaceState();
  const active = useActiveDeck();
  const dispatch = useDeckDispatch();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const open = (deckId: string) => {
    dispatch({ type: 'DECK/ACTIVATE', deckId });
    onOpenDesk();
  };

  const exportToFile = (deckId: string) => {
    const deck = state.decks.find((d) => d.id === deckId);
    if (!deck) return;
    const blob = new Blob([serializeDeck(deck)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${deck.name.toLowerCase().replace(/\s+/g, '-')}.cyberdeck.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    system.notifications.push({ kind: 'success', title: 'DECK EXPORTED', detail: deck.name });
  };

  const importFromFile = async (file: File) => {
    const result = importDeck(await file.text(), { freshIds: true });
    if (!result.ok || !result.deck) {
      setMessage(result.errors.join(' · '));
      return;
    }
    dispatch({ type: 'DECK/ADD', deck: result.deck });
    setMessage(
      result.warnings.length ? `Imported with notes: ${result.warnings.join(' · ')}` : `Imported ${result.deck.name}`,
    );
    onOpenDesk();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>DECKS</h1>
          <p className="faint">Each deck stores its modules, links, configuration, network and wallet.</p>
        </div>
        <div className="row wrap">
          <Button variant="primary" onClick={() => dispatch({ type: 'DECK/ADD', deck: createDeck('NEW DECK') })}>
            + NEW DECK
          </Button>
          <Button onClick={() => fileRef.current?.click()}>
            IMPORT
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFromFile(file);
              event.target.value = '';
            }}
          />
        </div>
      </div>

      {message ? <div className="alert-banner" data-tone="info">{message}</div> : null}

      <section className="col">
        <h2>YOUR DECKS</h2>
        <div className="cards">
          {state.decks.map((deck) => (
            <article key={deck.id} className="card">
              <div className="spread">
                <input
                  className="input"
                  value={deck.name}
                  onChange={(event) => dispatch({ type: 'DECK/RENAME', deckId: deck.id, name: event.target.value })}
                  style={{ maxWidth: 180 }}
                  aria-label="Deck name"
                />
                {deck.id === active.id ? <span className="chip" data-tone="accent">ACTIVE</span> : null}
              </div>
              <div className="row wrap faint" style={{ fontSize: 'var(--text-3xs)', gap: 'var(--space-4)' }}>
                <span>{deck.modules.length} MODULES</span>
                <span>{deck.connections.length} LINKS</span>
                <span>UPDATED {formatRelative(deck.updatedAt)} AGO</span>
              </div>
              <div className="row wrap" style={{ gap: 'var(--space-2)' }}>
                <Button variant="primary" onClick={() => open(deck.id)}>
                  OPEN
                </Button>
                <Button onClick={() => dispatch({ type: 'DECK/DUPLICATE', deckId: deck.id })}>
                  DUPLICATE
                </Button>
                <Button onClick={() => exportToFile(deck.id)}>
                  EXPORT
                </Button>
                <Button variant="danger" onClick={() => dispatch({ type: 'DECK/REMOVE', deckId: deck.id })} disabled={state.decks.length <= 1}>
                  DELETE
                </Button>
              </div>
              <details>
                <summary className="label" style={{ cursor: 'pointer' }}>DECK JSON</summary>
                <pre
                  className="scroll-y"
                  style={{
                    maxHeight: 160,
                    fontSize: 'var(--text-3xs)',
                    background: 'var(--surface-sunken)',
                    padding: 'var(--space-3)',
                    margin: 'var(--space-3) 0 0',
                  }}
                >
                  {JSON.stringify(exportDeck(deck), null, 2).slice(0, 2000)}
                </pre>
              </details>
            </article>
          ))}
        </div>
      </section>

      <section className="col">
        <h2>TEMPLATES</h2>
        <div className="cards">
          {DECK_TEMPLATES.map((template) => (
            <article key={template.id} className="card">
              <div className="spread">
                <span style={{ letterSpacing: 'var(--tracking-wide)' }}>{template.name}</span>
                <span className="chip">{template.modules.length} MODULES</span>
              </div>
              <p className="faint" style={{ fontSize: 'var(--text-3xs)', margin: 0 }}>
                {template.description}
              </p>
              <Button onClick={() => {
                  dispatch({ type: 'DECK/ADD', deck: instantiateTemplate(template) });
                  onOpenDesk();
                }}>
                CREATE DECK
              </Button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
