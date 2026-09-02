import { useEffect, useState } from 'react';
import type { ModuleInstance } from '../../core/modules/types';
import { Stat } from '../../components/ui/States';
import { useModuleOutputs } from '../../state/moduleIO';

const SESSION_START = Date.now();

export function Component({ module }: { module: ModuleInstance }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useModuleOutputs(module.id, { timestamp: now });

  const date = new Date(now);
  const uptimeSec = Math.floor((now - SESSION_START) / 1000);
  const uptime = `${String(Math.floor(uptimeSec / 3600)).padStart(2, '0')}:${String(
    Math.floor((uptimeSec % 3600) / 60),
  ).padStart(2, '0')}:${String(uptimeSec % 60).padStart(2, '0')}`;

  return (
    <>
      <Stat label="LOCAL" value={date.toLocaleTimeString([], { hour12: false })} size="lg" />
      <div className="row wrap" style={{ gap: 'var(--space-6)' }}>
        <Stat label="UTC" value={date.toISOString().slice(11, 19)} size="sm" />
        <Stat label="SESSION" value={uptime} size="sm" />
      </div>
    </>
  );
}
