import { useCallback, useEffect, useState } from 'react';

export type RouteId =
  | 'desk'
  | 'decks'
  | 'markets'
  | 'wallets'
  | 'circuits'
  | 'alerts'
  | 'transactions'
  | 'settings';

const ROUTES: RouteId[] = ['desk', 'decks', 'markets', 'wallets', 'circuits', 'alerts', 'transactions', 'settings'];

function parse(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, '').split('/')[0] as RouteId;
  return ROUTES.includes(id) ? id : 'desk';
}

/** Hash routing — no dependency, and deep links survive a reload. */
export function useRoute(): [RouteId, (route: RouteId) => void] {
  const [route, setRoute] = useState<RouteId>(() =>
    typeof window === 'undefined' ? 'desk' : parse(window.location.hash),
  );

  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((next: RouteId) => {
    window.location.hash = `#/${next}`;
    setRoute(next);
  }, []);

  return [route, navigate];
}

export const ROUTE_META: Record<RouteId, { label: string; icon: string }> = {
  desk: { label: 'CYBER DESK', icon: '▦' },
  decks: { label: 'DECKS', icon: '⌸' },
  markets: { label: 'MARKETS', icon: '≈' },
  wallets: { label: 'WALLETS', icon: '◈' },
  circuits: { label: 'CIRCUITS', icon: '⌗' },
  alerts: { label: 'ALERTS', icon: '!' },
  transactions: { label: 'TRANSACTIONS', icon: '≡' },
  settings: { label: 'SETTINGS', icon: '⚙' },
};
