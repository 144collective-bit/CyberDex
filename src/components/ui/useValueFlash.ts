import { useEffect, useRef, useState } from 'react';

export type FlashDirection = 'up' | 'down' | null;

/**
 * Flash direction for a number that just changed.
 *
 * Every trading terminal signals a tick this way, and without it a live price
 * is indistinguishable from a frozen one. Returns null until a real change
 * arrives, so a module does not flash on mount.
 */
export function useValueFlash(value: number | null | undefined, durationMs = 700): FlashDirection {
  const previous = useRef<number | null | undefined>(undefined);
  const [flash, setFlash] = useState<FlashDirection>(null);

  useEffect(() => {
    const last = previous.current;
    previous.current = value;
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    // First value is the baseline, not a movement.
    if (last === null || last === undefined || last === value) return;

    setFlash(value > last ? 'up' : 'down');
    const timer = setTimeout(() => setFlash(null), durationMs);
    return () => clearTimeout(timer);
  }, [value, durationMs]);

  return flash;
}
