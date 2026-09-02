import { describe, expect, it } from 'vitest';
import { getModuleDefinition, listModuleDefinitions } from '../core/modules/registry';
import { canConnect } from '../core/modules/ports';
import { validateLink } from '../core/graph/linkGraph';
import { hasModuleComponent } from '../modules/components';
import { DECK_TEMPLATES, buildDefaultWorkspace, instantiateTemplate } from '../modules/templates';
import { calculate } from '../modules/components/CalculatorModule';
import { projectStake } from '../modules/components/HexStakesModule';

describe('module catalogue', () => {
  it('registers a renderer, ports and a version for every definition', () => {
    const definitions = listModuleDefinitions();
    expect(definitions.length).toBeGreaterThanOrEqual(20);
    for (const definition of definitions) {
      expect(hasModuleComponent(definition.type), `${definition.type} has no component`).toBe(true);
      expect(definition.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(definition.defaultSize.width).toBeGreaterThanOrEqual(definition.minSize.width);
      expect(definition.defaultSize.height).toBeGreaterThanOrEqual(definition.minSize.height);
      // Ids are namespaced per side, so a pass-through module may expose
      // `token` as both an input and an output — but never twice on one side.
      const inputIds = definition.inputs.map((p) => p.id);
      const outputIds = definition.outputs.map((p) => p.id);
      expect(new Set(inputIds).size).toBe(inputIds.length);
      expect(new Set(outputIds).size).toBe(outputIds.length);
    }
  });

  it('marks only the swap terminal as execution capable', () => {
    const executors = listModuleDefinitions().filter((d) => d.permission === 'EXECUTION_CAPABLE');
    expect(executors.map((d) => d.type)).toEqual(['swap']);
  });
});

describe('deck templates', () => {
  it('builds a valid genesis workspace on first run', () => {
    const workspace = buildDefaultWorkspace();
    expect(workspace.decks).toHaveLength(1);
    const deck = workspace.decks[0]!;
    expect(deck.name).toBe('GENESIS DECK');
    expect(deck.modules).toHaveLength(8);
    expect(deck.connections).toHaveLength(6);
    expect(workspace.activeDeckId).toBe(deck.id);
  });

  it('wires every template link to real, type-compatible ports', () => {
    for (const template of DECK_TEMPLATES) {
      const deck = instantiateTemplate(template);
      expect(deck.connections).toHaveLength(template.links.length);
      for (const connection of deck.connections) {
        const source = deck.modules.find((m) => m.id === connection.sourceModuleId)!;
        const target = deck.modules.find((m) => m.id === connection.targetModuleId)!;
        const outPort = getModuleDefinition(source.type)!.outputs.find((p) => p.id === connection.sourceOutput);
        const inPort = getModuleDefinition(target.type)!.inputs.find((p) => p.id === connection.targetInput);
        expect(outPort, `${template.name}: ${source.type}.${connection.sourceOutput}`).toBeTruthy();
        expect(inPort, `${template.name}: ${target.type}.${connection.targetInput}`).toBeTruthy();
        expect(canConnect(outPort!.type, inPort!.type), `${template.name}: ${outPort!.type}→${inPort!.type}`).toBe(true);
      }
    }
  });

  it('gives every instantiated module a unique id', () => {
    const deck = instantiateTemplate(DECK_TEMPLATES[0]!);
    expect(new Set(deck.modules.map((m) => m.id)).size).toBe(deck.modules.length);
  });

  it('accepts a further valid link and rejects an invalid one', () => {
    const deck = instantiateTemplate(DECK_TEMPLATES[0]!);
    const pair = deck.modules.find((m) => m.type === 'pair-selector')!;
    const swap = deck.modules.find((m) => m.type === 'swap')!;
    // TOKEN → SELL TOKEN is legal…
    expect(
      validateLink(deck, { moduleId: pair.id, portId: 'tokenA' }, { moduleId: swap.id, portId: 'tokenA' }).ok,
    ).toBe(true);
    // …PAIR → AMOUNT is not, and neither is RATIO → AMOUNT: a ratio is not a size.
    expect(
      validateLink(deck, { moduleId: pair.id, portId: 'pair' }, { moduleId: swap.id, portId: 'amount' }).ok,
    ).toBe(false);
    expect(
      validateLink(deck, { moduleId: pair.id, portId: 'ratio' }, { moduleId: swap.id, portId: 'amount' }).ok,
    ).toBe(false);
  });
});

describe('module maths', () => {
  it('calculates each supported operation', () => {
    expect(calculate('percent', 20_000, 25)).toBe(5_000);
    expect(calculate('multiply', 3, 4)).toBe(12);
    expect(calculate('divide', 10, 4)).toBe(2.5);
    expect(calculate('add', 10, 4)).toBe(14);
    expect(calculate('subtract', 10, 4)).toBe(6);
    expect(calculate('roi', 150, 100)).toBe(50);
  });

  it('never divides by zero', () => {
    expect(calculate('divide', 10, 0)).toBe(0);
    expect(calculate('ratio', 10, 0)).toBe(0);
    expect(calculate('roi', 10, 0)).toBe(0);
  });

  it('projects longer stakes to more T-shares for the same principal', () => {
    const short = projectStake(100_000, 365, 24_000);
    const long = projectStake(100_000, 3650, 24_000);
    expect(long.tShares).toBeGreaterThan(short.tShares);
    expect(long.effective).toBeGreaterThan(100_000);
  });
});
