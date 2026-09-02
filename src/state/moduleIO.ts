import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { activeDeck } from '../core/deck/deckReducer';
import { incomingLinks } from '../core/graph/linkGraph';
import type { Connection } from '../core/modules/types';
import { useStoreSelector, shallowArrayEqual } from '../core/useStore';
import { useSystem } from './system';
import { useDeckActions } from './deck';

const EMPTY: Record<string, unknown> = Object.freeze({});

function shallowEqualRecord(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((key) => Object.is(a[key], b[key]));
}

/**
 * Values arriving on a module's input ports.
 *
 * The subscription is scoped to the upstream modules this module is actually
 * linked to, so an upstream price tick re-renders this module alone.
 */
export function useModuleInputs(moduleId: string): Record<string, unknown> {
  const system = useSystem();
  const links = useStoreSelector(
    system.workspace,
    (s) => {
      const deck = activeDeck(s);
      return deck ? incomingLinks(deck, moduleId) : ([] as Connection[]);
    },
    shallowArrayEqual,
  );

  const sourceIds = useMemo(
    () => Array.from(new Set(links.map((l) => l.sourceModuleId))),
    [links],
  );
  const sourceKey = sourceIds.join('|');

  const subscribe = useCallback(
    (onChange: () => void) => {
      const unsubs = sourceIds.map((id) => system.runtime.subscribe(id, onChange));
      return () => unsubs.forEach((fn) => fn());
    },
    // sourceKey keeps the callback stable while the same upstream set applies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [system, sourceKey],
  );

  const cache = useRef<Record<string, unknown>>(EMPTY);
  const getSnapshot = useCallback(() => {
    const next: Record<string, unknown> = {};
    for (const link of links) {
      const value = system.runtime.getOutput(link.sourceModuleId, link.sourceOutput);
      if (value !== undefined) next[link.targetInput] = value;
    }
    if (shallowEqualRecord(cache.current, next)) return cache.current;
    cache.current = next;
    return next;
  }, [links, system]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Publish this module's outputs. Values are shallow-compared before notifying. */
export function useModuleOutputs(moduleId: string, outputs: Record<string, unknown>): void {
  const system = useSystem();
  const previous = useRef<Record<string, unknown>>(EMPTY);

  useEffect(() => {
    if (shallowEqualRecord(previous.current, outputs)) return;
    previous.current = outputs;
    system.runtime.setOutputs(moduleId, outputs);
  }, [system, moduleId, outputs]);

  useEffect(() => () => system.runtime.clearModule(moduleId), [system, moduleId]);
}

export function useModuleConfig<T extends Record<string, unknown>>(
  moduleId: string,
  configuration: T,
): [T, (patch: Partial<T>) => void] {
  const { configureModule } = useDeckActions();
  const setConfig = useCallback(
    (patch: Partial<T>) => configureModule(moduleId, patch as Record<string, unknown>),
    [configureModule, moduleId],
  );
  return [configuration, setConfig];
}

/** True when the named input port is driven by a link rather than local state. */
export function isLinked(inputs: Record<string, unknown>, portId: string): boolean {
  return inputs[portId] !== undefined;
}
