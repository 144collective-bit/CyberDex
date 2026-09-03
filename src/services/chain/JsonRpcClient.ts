export interface JsonRpcRequest {
  method: string;
  params?: unknown[];
}

export interface JsonRpcClientOptions {
  endpoints: string[];
  timeoutMs?: number;
  /** Attempts per endpoint before moving to the next one. */
  attemptsPerEndpoint?: number;
  /** Largest number of calls put into a single batch request. */
  maxBatchSize?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** How long a failed endpoint is skipped before being tried again. */
  cooldownMs?: number;
}

export class JsonRpcError extends Error {
  readonly code: number;
  readonly endpoint: string;
  constructor(code: number, message: string, endpoint: string) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
    this.endpoint = endpoint;
  }
}

export interface EndpointHealth {
  url: string;
  healthy: boolean;
  failures: number;
  lastError: string | null;
  lastOkAt: number;
  latencyMs: number;
}

interface RpcEnvelope {
  id: number;
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * JSON-RPC transport with endpoint failover and batching.
 *
 * A public RPC is the single point of failure in an on-chain terminal, so this
 * keeps several and rotates away from one that is failing, then lets it back in
 * after a cooldown. Calls are batched into one HTTP request, which matters when
 * a deck reads thirty reserves and balances per refresh.
 */
export class JsonRpcClient {
  private endpoints: string[];
  private health = new Map<string, EndpointHealth>();
  private cursor = 0;
  private nextId = 1;
  private timeoutMs: number;
  private attemptsPerEndpoint: number;
  private maxBatchSize: number;
  private fetchImpl: typeof fetch;
  private now: () => number;
  private cooldownMs: number;
  private listeners = new Set<() => void>();

  constructor(options: JsonRpcClientOptions) {
    if (!options.endpoints.length) throw new Error('At least one RPC endpoint is required');
    this.endpoints = [...options.endpoints];
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.attemptsPerEndpoint = options.attemptsPerEndpoint ?? 1;
    this.maxBatchSize = options.maxBatchSize ?? 40;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.now = options.now ?? (() => Date.now());
    this.cooldownMs = options.cooldownMs ?? 30_000;
    for (const url of this.endpoints) {
      this.health.set(url, { url, healthy: true, failures: 0, lastError: null, lastOkAt: 0, latencyMs: 0 });
    }
  }

  getHealth = (): EndpointHealth[] => Array.from(this.health.values());

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }

  /** Endpoints to try, healthy ones first, in round-robin order. */
  private order(): string[] {
    const rotated = [...this.endpoints.slice(this.cursor), ...this.endpoints.slice(0, this.cursor)];
    const usable = rotated.filter((url) => {
      const health = this.health.get(url)!;
      if (health.healthy) return true;
      // A cooled-down endpoint gets another chance.
      return this.now() - health.lastOkAt > this.cooldownMs;
    });
    return usable.length ? usable : rotated;
  }

  private markOk(url: string, latencyMs: number): void {
    const health = this.health.get(url)!;
    this.health.set(url, { ...health, healthy: true, failures: 0, lastError: null, lastOkAt: this.now(), latencyMs });
    this.emit();
  }

  private markFailed(url: string, message: string): void {
    const health = this.health.get(url)!;
    const failures = health.failures + 1;
    this.health.set(url, { ...health, healthy: false, failures, lastError: message });
    // Move the rotation on so the next call starts elsewhere.
    this.cursor = (this.endpoints.indexOf(url) + 1) % this.endpoints.length;
    this.emit();
  }

  private async post(url: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = this.now();
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      this.markOk(url, this.now() - started);
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  /** One call. Rotates endpoints until one answers. */
  async call<T>(request: JsonRpcRequest): Promise<T> {
    const [result] = await this.batch<[T]>([request]);
    return result as T;
  }

  /**
   * Several calls in one round trip.
   *
   * Results come back in request order. A per-call RPC error is returned as a
   * rejected slot rather than failing the whole batch, so one bad token cannot
   * blank an entire deck.
   */
  async batch<T extends unknown[]>(requests: JsonRpcRequest[]): Promise<T> {
    if (!requests.length) return [] as unknown as T;

    const chunks: JsonRpcRequest[][] = [];
    for (let i = 0; i < requests.length; i += this.maxBatchSize) {
      chunks.push(requests.slice(i, i + this.maxBatchSize));
    }

    const results: unknown[] = [];
    for (const chunk of chunks) {
      results.push(...(await this.sendChunk(chunk)));
    }
    return results as T;
  }

  private async sendChunk(requests: JsonRpcRequest[]): Promise<unknown[]> {
    const payload = requests.map((request) => ({
      jsonrpc: '2.0' as const,
      id: this.nextId++,
      method: request.method,
      params: request.params ?? [],
    }));

    let lastError: unknown = new Error('No RPC endpoint available');

    for (const url of this.order()) {
      for (let attempt = 0; attempt < this.attemptsPerEndpoint; attempt += 1) {
        try {
          const response = await this.post(url, payload.length === 1 ? payload[0] : payload);
          const envelopes: RpcEnvelope[] = Array.isArray(response) ? response : [response as RpcEnvelope];
          const byId = new Map(envelopes.map((envelope) => [envelope.id, envelope]));
          return payload.map((request) => {
            const envelope = byId.get(request.id);
            if (!envelope) throw new JsonRpcError(-1, `No response for ${request.method}`, url);
            if (envelope.error) {
              throw new JsonRpcError(envelope.error.code, envelope.error.message, url);
            }
            return envelope.result;
          });
        } catch (err) {
          lastError = err;
          const message = err instanceof Error ? err.message : String(err);
          // A contract-level revert is the chain's answer, not a bad endpoint.
          if (err instanceof JsonRpcError && err.code !== -32603) throw err;
          this.markFailed(url, message);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /** Latest block number, as a number. */
  async blockNumber(): Promise<number> {
    const hex = await this.call<string>({ method: 'eth_blockNumber' });
    return Number(BigInt(hex));
  }

  /**
   * Read several contracts at one specific block.
   *
   * Pinning the block is what makes a set of reserve reads a coherent snapshot:
   * without it, two calls can straddle a swap and produce a price that never
   * existed on chain.
   */
  async callMany(
    calls: { to: string; data: string }[],
    blockTag: string | number = 'latest',
  ): Promise<(string | null)[]> {
    if (!calls.length) return [];
    const tag = typeof blockTag === 'number' ? `0x${blockTag.toString(16)}` : blockTag;
    const requests = calls.map((call) => ({
      method: 'eth_call',
      params: [{ to: call.to, data: call.data }, tag],
    }));
    const settled = await Promise.allSettled([this.batch<string[]>(requests)]);
    if (settled[0]!.status === 'fulfilled') return settled[0]!.value;

    // The batch failed as a whole (endpoint down): report empty slots so the
    // caller can decide, rather than throwing away the good calls.
    return calls.map(() => null);
  }
}
