import { useMemo } from 'react';
import { getModuleDefinition, createModuleInstance } from '../core/modules/registry';
import type { Deck } from '../core/modules/types';
import { MODULE_TYPES } from '../modules/definitions';
import { useActiveDeck, useDeckActions } from '../state/deck';
import { useSystem } from '../state/system';
import { Button } from '../components/ui/Button';

interface CircuitPreset {
  id: string;
  name: string;
  purpose: string;
  steps: string[];
  build: { key: string; type: string; x: number; y: number; config?: Record<string, unknown> }[];
  links: [string, string, string, string][];
}

/** The three reference circuits from the product spec, buildable in one click. */
const PRESETS: CircuitPreset[] = [
  {
    id: 'balance-to-trade',
    name: 'BALANCE → 25% → TRADE',
    purpose: 'Size a trade as a fixed share of the wallet, then hand it to the swap terminal.',
    steps: ['WALLET', 'PORTFOLIO VALUE', '25% CALCULATOR', 'SWAP AMOUNT', 'REVIEW', 'CONFIRMATION', 'TRANSACTION'],
    build: [
      { key: 'wallet', type: MODULE_TYPES.wallet, x: 40, y: 900 },
      { key: 'portfolio', type: MODULE_TYPES.portfolio, x: 380, y: 900 },
      { key: 'calc', type: MODULE_TYPES.calculator, x: 740, y: 900, config: { operation: 'percent', operand: 25 } },
      { key: 'swap', type: MODULE_TYPES.swap, x: 1060, y: 900 },
      { key: 'tx', type: MODULE_TYPES.transactions, x: 40, y: 1240 },
    ],
    links: [
      ['wallet', 'wallet', 'portfolio', 'wallet'],
      ['portfolio', 'totalValue', 'calc', 'value'],
      ['calc', 'result', 'swap', 'amount'],
      ['wallet', 'wallet', 'swap', 'wallet'],
      ['wallet', 'wallet', 'tx', 'wallet'],
    ],
  },
  {
    id: 'ratio-alert',
    name: 'PAIR → RATIO → THRESHOLD → ALERT',
    purpose: 'Watch a pair ratio and raise a signal when it crosses your level.',
    steps: ['PAIR SELECTOR', 'RATIO', 'THRESHOLD', 'ALERT'],
    build: [
      { key: 'pair', type: MODULE_TYPES.pairSelector, x: 40, y: 1500 },
      { key: 'ratio', type: MODULE_TYPES.ratio, x: 380, y: 1500 },
      { key: 'alert', type: MODULE_TYPES.alert, x: 720, y: 1500, config: { condition: 'RATIO_BELOW', label: 'RATIO FLOOR' } },
    ],
    links: [
      ['pair', 'pair', 'ratio', 'pair'],
      ['ratio', 'ratio', 'alert', 'value'],
    ],
  },
  {
    id: 'whale-alert',
    name: 'WATCH → MOVEMENT → VALUE → ALERT',
    purpose: 'Escalate only the wallet movements that clear a size threshold.',
    steps: ['WHALE WATCH', 'MOVEMENT VALUE', 'THRESHOLD', 'ALERT'],
    build: [
      { key: 'whales', type: MODULE_TYPES.whaleWatch, x: 40, y: 1780 },
      { key: 'alert', type: MODULE_TYPES.alert, x: 500, y: 1780, config: { condition: 'WHALE_VALUE_ABOVE', threshold: 250000, label: 'WHALE SIZE' } },
      { key: 'info', type: MODULE_TYPES.tokenInfo, x: 840, y: 1780 },
    ],
    links: [
      ['whales', 'movementValue', 'alert', 'value'],
      ['whales', 'token', 'info', 'token'],
    ],
  },
];

/** Layer modules by dependency depth so the deck reads left to right. */
function layerDeck(deck: Deck): string[][] {
  const depth = new Map<string, number>();
  const resolve = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = deck.connections.filter((c) => c.targetModuleId === id);
    const value = parents.length === 0 ? 0 : Math.max(...parents.map((c) => resolve(c.sourceModuleId, seen) + 1));
    depth.set(id, value);
    return value;
  };
  for (const module of deck.modules) resolve(module.id);
  const layers: string[][] = [];
  for (const module of deck.modules) {
    const level = depth.get(module.id) ?? 0;
    (layers[level] ??= []).push(module.id);
  }
  return layers.filter(Boolean);
}

export function CircuitsPage({ onOpenDesk }: { onOpenDesk: () => void }) {
  const system = useSystem();
  const deck = useActiveDeck();
  const actions = useDeckActions();
  const layers = useMemo(() => layerDeck(deck), [deck]);

  const build = (preset: CircuitPreset) => {
    const idByKey = new Map<string, string>();
    for (const entry of preset.build) {
      const instance = createModuleInstance(entry.type, {
        position: { x: entry.x, y: entry.y },
        configuration: entry.config,
      });
      idByKey.set(entry.key, instance.id);
      actions.dispatch({ type: 'MODULE/INSERT', deckId: actions.deckId, module: instance });
    }
    for (const [from, output, to, input] of preset.links) {
      const source = idByKey.get(from);
      const target = idByKey.get(to);
      if (!source || !target) continue;
      actions.connect({ moduleId: source, portId: output }, { moduleId: target, portId: input });
    }
    system.notifications.push({
      kind: 'success',
      title: 'CIRCUIT BUILT',
      detail: `${preset.name} added to ${deck.name}`,
    });
    onOpenDesk();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>CIRCUIT LAB</h1>
          <p className="faint">
            How data actually flows through {deck.name}. Circuits are informational — nothing here executes on its own.
          </p>
        </div>
      </div>

      <section className="card">
        <h2>ACTIVE CIRCUIT MAP</h2>
        {deck.connections.length === 0 ? (
          <div className="empty">
            <h5>NO LINKS YET</h5>
            <p>Drag from a module’s output port to another module’s input to wire your first circuit.</p>
          </div>
        ) : (
          <div className="row scroll-y" style={{ alignItems: 'stretch', gap: 'var(--space-7)', overflowX: 'auto', paddingBottom: 'var(--space-4)' }}>
            {layers.map((layer, index) => (
              <div key={index} className="col" style={{ gap: 'var(--space-3)', minWidth: 190 }}>
                <span className="label">STAGE {index + 1}</span>
                {layer.map((moduleId) => {
                  const module = deck.modules.find((m) => m.id === moduleId)!;
                  const definition = getModuleDefinition(module.type);
                  const outgoing = deck.connections.filter((c) => c.sourceModuleId === moduleId);
                  return (
                    <div
                      key={moduleId}
                      className="col"
                      style={{
                        gap: 2,
                        padding: 'var(--space-3)',
                        border: '1px solid var(--border)',
                        background: 'var(--surface-raised)',
                      }}
                    >
                      <div className="row" style={{ gap: 'var(--space-2)' }}>
                        <span aria-hidden>{definition?.icon}</span>
                        <span className="truncate">{module.name}</span>
                      </div>
                      {outgoing.map((link) => {
                        const target = deck.modules.find((m) => m.id === link.targetModuleId);
                        return (
                          <span key={link.id} className="faint" style={{ fontSize: 'var(--text-3xs)' }}>
                            {link.sourceOutput} ─▶ {target?.name ?? '?'}·{link.targetInput}
                          </span>
                        );
                      })}
                      {outgoing.length === 0 ? (
                        <span className="faint" style={{ fontSize: 'var(--text-3xs)' }}>TERMINAL NODE</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="col">
        <h2>CIRCUIT PRESETS</h2>
        <div className="cards">
          {PRESETS.map((preset) => (
            <article key={preset.id} className="card">
              <span style={{ letterSpacing: 'var(--tracking-wide)' }}>{preset.name}</span>
              <p className="faint" style={{ margin: 0, fontSize: 'var(--text-3xs)' }}>{preset.purpose}</p>
              <div className="col" style={{ gap: 2 }}>
                {preset.steps.map((step, index) => (
                  <span key={step} className="faint" style={{ fontSize: 'var(--text-3xs)' }}>
                    {index > 0 ? '↓ ' : ''}
                    {step}
                  </span>
                ))}
              </div>
              <Button variant="primary" onClick={() => build(preset)}>
                BUILD ON {deck.name}
              </Button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
