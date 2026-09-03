import type { EventBus } from '../../core/events/bus';
import type { GasSnapshot, ServiceHealth, SystemStatus } from '../../core/types';
import type { ChainProvider } from '../chain/ChainProvider';
import type { MarketDataProvider } from '../market/MarketDataProvider';
import type { RoutingEngine } from '../dex/RoutingEngine';

export interface TelemetrySnapshot {
  chainId: number;
  gas: GasSnapshot | null;
  status: SystemStatus;
  error: string | null;
}

interface ChainChannel {
  snapshot: TelemetrySnapshot;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  polling: boolean;
}

const IDLE_STATUS: SystemStatus = { rpc: 'unknown', indexer: 'unknown', router: 'unknown', lastCheck: 0 };

/**
 * One poller per chain, shared by everything that displays network state.
 *
 * Before this existed the top bar, status bar and every Gas/Network module each
 * ran their own interval — four or more identical RPC round trips every tick,
 * and four duplicate GAS_UPDATED events. Polling now starts with the first
 * subscriber and stops with the last.
 */
export class TelemetryService {
  private channels = new Map<number, ChainChannel>();
  private chainFor: (chainId: number) => ChainProvider;
  private market: MarketDataProvider;
  private routing: RoutingEngine;
  private bus: EventBus;
  private intervalMs: number;

  constructor(
    deps: {
      chainFor: (chainId: number) => ChainProvider;
      market: MarketDataProvider;
      routing: RoutingEngine;
      bus: EventBus;
    },
    intervalMs = 12_000,
  ) {
    this.chainFor = deps.chainFor;
    this.market = deps.market;
    this.routing = deps.routing;
    this.bus = deps.bus;
    this.intervalMs = intervalMs;
  }

  private channel(chainId: number): ChainChannel {
    let channel = this.channels.get(chainId);
    if (!channel) {
      channel = {
        snapshot: { chainId, gas: null, status: IDLE_STATUS, error: null },
        listeners: new Set(),
        timer: null,
        polling: false,
      };
      this.channels.set(chainId, channel);
    }
    return channel;
  }

  getSnapshot = (chainId: number): TelemetrySnapshot => this.channel(chainId).snapshot;

  subscribe(chainId: number, listener: () => void): () => void {
    const channel = this.channel(chainId);
    channel.listeners.add(listener);
    if (channel.listeners.size === 1) this.start(chainId);
    return () => {
      channel.listeners.delete(listener);
      if (channel.listeners.size === 0) this.stop(chainId);
    };
  }

  /** Force an immediate refresh — used on network switch. */
  async refresh(chainId: number): Promise<void> {
    await this.poll(chainId);
  }

  private start(chainId: number): void {
    const channel = this.channel(chainId);
    if (channel.timer) return;
    void this.poll(chainId);
    if (typeof setInterval !== 'function') return;
    channel.timer = setInterval(() => void this.poll(chainId), this.intervalMs);
  }

  private stop(chainId: number): void {
    const channel = this.channels.get(chainId);
    if (!channel?.timer) return;
    clearInterval(channel.timer);
    channel.timer = null;
  }

  private async poll(chainId: number): Promise<void> {
    const channel = this.channel(chainId);
    // A slow RPC must not stack requests on top of each other.
    if (channel.polling) return;
    channel.polling = true;
    try {
      const chain = this.chainFor(chainId);
      const gas = await chain.getGas();
      const [rpc, indexer] = await Promise.all([chain.health(), this.market.health()]);
      const router: ServiceHealth = this.routing.list(chainId).length > 0 ? 'online' : 'offline';
      this.publish(chainId, {
        chainId,
        gas,
        status: { rpc, indexer, router, lastCheck: Date.now() },
        error: null,
      });
      this.bus.emit('GAS_UPDATED', { gas }, 'telemetry');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Telemetry unavailable';
      this.publish(chainId, {
        ...channel.snapshot,
        status: { ...channel.snapshot.status, rpc: 'offline', lastCheck: Date.now() },
        error: message,
      });
    } finally {
      channel.polling = false;
    }
  }

  private publish(chainId: number, snapshot: TelemetrySnapshot): void {
    const channel = this.channel(chainId);
    channel.snapshot = snapshot;
    for (const listener of Array.from(channel.listeners)) listener();
  }

  dispose(): void {
    for (const chainId of Array.from(this.channels.keys())) this.stop(chainId);
    this.channels.clear();
  }

  /** Diagnostics: how many pollers are actually running. */
  activePollers(): number {
    return Array.from(this.channels.values()).filter((channel) => channel.timer !== null).length;
  }
}
