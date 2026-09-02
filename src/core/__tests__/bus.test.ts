import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../events/bus';

describe('EventBus', () => {
  it('delivers payloads to typed subscribers', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('NETWORK_CHANGED', handler);
    bus.emit('NETWORK_CHANGED', { chainId: 369 }, 'test');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toEqual({ chainId: 369 });
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.on('NETWORK_CHANGED', handler);
    off();
    bus.emit('NETWORK_CHANGED', { chainId: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('notifies wildcard subscribers with the full record', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.onAny((record) => seen.push(record.type));
    bus.emit('PAIR_CHANGED', { pair: { id: 'p', base: {} as never, quote: {} as never, label: 'A/B' } });
    bus.emit('QUOTE_FAILED', { reason: 'no route' });
    expect(seen).toEqual(['PAIR_CHANGED', 'QUOTE_FAILED']);
  });

  it('contains a throwing handler so other subscribers still run', () => {
    const bus = new EventBus();
    const ok = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bus.on('NETWORK_CHANGED', () => {
      throw new Error('boom');
    });
    bus.on('NETWORK_CHANGED', ok);
    expect(() => bus.emit('NETWORK_CHANGED', { chainId: 1 })).not.toThrow();
    expect(ok).toHaveBeenCalled();
  });

  it('keeps a bounded history for the activity log', () => {
    const bus = new EventBus(3);
    for (let i = 0; i < 5; i += 1) bus.emit('NETWORK_CHANGED', { chainId: i });
    const history = bus.getHistory();
    expect(history).toHaveLength(3);
    expect((history[2]?.payload as { chainId: number }).chainId).toBe(4);
  });
});
