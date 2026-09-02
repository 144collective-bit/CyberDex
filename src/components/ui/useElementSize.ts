import { useEffect, useRef, useState } from 'react';

/** Element size via ResizeObserver — charts resize with their module. */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof ResizeObserver === 'undefined') {
      setSize({ width: node.clientWidth, height: node.clientHeight });
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) =>
        Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
          ? prev
          : { width, height },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}
