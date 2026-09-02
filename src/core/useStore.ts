import { useCallback, useRef, useSyncExternalStore } from 'react';

export interface ReadableStore<T> {
  getState: () => T;
  subscribe: (listener: () => void) => () => void;
}

/**
 * `useSyncExternalStore` with a selector and an equality check, so a component
 * only re-renders when the slice it actually reads changes.
 */
export function useStoreSelector<T, S>(
  store: ReadableStore<T>,
  selector: (state: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  const cache = useRef<{ state: T; slice: S } | null>(null);

  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const current = cache.current;
    if (current && current.state === state) return current.slice;
    const slice = selector(state);
    if (current && isEqual(current.slice, slice)) {
      cache.current = { state, slice: current.slice };
      return current.slice;
    }
    cache.current = { state, slice };
    return slice;
  }, [store, selector, isEqual]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
  return true;
}
