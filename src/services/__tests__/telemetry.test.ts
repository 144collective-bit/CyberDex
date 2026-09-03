import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/events/bus';
import { TelemetryService } from '../telemetry/TelemetryService';
import { DemoChainProvider } from '../chain/DemoChainProvider';
import { DemoMarketDataProvider } from '../market/DemoMarketDataProvider';
import { RoutingEngine } from '../dex/RoutingEngine';
import { DemoDexAdapter } from '../dex/adapters/DemoDexAdapter';

function harness(intervalMs = 60_000) {
  const bus = new EventBus();
  const market = new DemoMarketDataProvider(0);
  const routing = new RoutingEngine();
  routing.register(
    new DemoDexAdapter(
      { id: 'd', label: 'D', chainIds: [369], feePct: 0.003, liquidityShare: 0.5, router: '0x1' },
      market,
    ),
  );
  const chains = new Map<number, DemoChainProvider>();
  let gasCalls = 0;
  const chainFor = (chainId: number) => {
    let chain = chains.get(chainId);
    if (!chain) {
      chain = new DemoChainProvider(chainId);
      const original = chain.getGas.bind(chain);
      chain.getGas = async () => {
        gasCalls += 1;
        return original();
      };
      chains.set(chainId, chain);
    }
    return chain;
  };
  const telemetry = new TelemetryService({ chainFor, market, routing, bus }, intervalMs);
  return { telemetry, bus, gasCalls: () => gasCalls };
}

describe('TelemetryService', () => {
  it('runs one poller no matter how many subscribers a chain has', async () => {
    const { telemetry, gasCalls } = harness();
    const offs = [0, 1, 2, 3].map(() => telemetry.subscribe(369, () => undefined));
    await vi.waitFor(() => expect(gasCalls()).toBeGreaterThan(0));
    expect(telemetry.activePollers()).toBe(1);
    // Four subscribers, but the initial poll happened once.
    expect(gasCalls()).toBe(1);
    offs.forEach((off) => off());
    telemetry.dispose();
  });

  it('stops polling when the last subscriber leaves, and restarts for a new one', async () => {
    const { telemetry, gasCalls } = harness();
    const off = telemetry.subscribe(369, () => undefined);
    // Wait for the poll to finish, not just to start: a poll still in flight
    // deliberately suppresses a second one.
    await vi.waitFor(() => expect(telemetry.getSnapshot(369).gas).not.toBeNull());
    off();
    expect(telemetry.activePollers()).toBe(0);

    const before = gasCalls();
    const off2 = telemetry.subscribe(369, () => undefined);
    await vi.waitFor(() => expect(gasCalls()).toBeGreaterThan(before));
    expect(telemetry.activePollers()).toBe(1);
    off2();
    telemetry.dispose();
  });

  it('keeps chains independent', async () => {
    const { telemetry } = harness();
    const a = telemetry.subscribe(369, () => undefined);
    const b = telemetry.subscribe(1, () => undefined);
    await vi.waitFor(() => {
      expect(telemetry.getSnapshot(369).gas).not.toBeNull();
      expect(telemetry.getSnapshot(1).gas).not.toBeNull();
    });
    expect(telemetry.getSnapshot(369).gas?.chainId).toBe(369);
    expect(telemetry.getSnapshot(1).gas?.chainId).toBe(1);
    expect(telemetry.activePollers()).toBe(2);
    a();
    b();
    telemetry.dispose();
  });

  it('notifies subscribers and emits one GAS_UPDATED per poll', async () => {
    const { telemetry, bus } = harness();
    const gasEvents = vi.fn();
    bus.on('GAS_UPDATED', gasEvents);
    const listener = vi.fn();
    const off = telemetry.subscribe(369, listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    expect(gasEvents).toHaveBeenCalledTimes(1);
    off();
    telemetry.dispose();
  });

  it('records an error without losing the last good snapshot', async () => {
    const bus = new EventBus();
    const market = new DemoMarketDataProvider(0);
    const routing = new RoutingEngine();
    const chain = new DemoChainProvider(369);
    chain.getGas = async () => {
      throw new Error('RPC unreachable');
    };
    const telemetry = new TelemetryService({ chainFor: () => chain, market, routing, bus }, 5000);
    const off = telemetry.subscribe(369, () => undefined);
    await vi.waitFor(() => expect(telemetry.getSnapshot(369).error).toBe('RPC unreachable'));
    expect(telemetry.getSnapshot(369).status.rpc).toBe('offline');
    off();
    telemetry.dispose();
  });
});
