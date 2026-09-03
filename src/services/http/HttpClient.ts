export interface HttpClientOptions {
  baseUrl?: string;
  /** Abort a request that has not answered in this long. */
  timeoutMs?: number;
  /** Retries for transport errors and 5xx/429 responses. */
  retries?: number;
  /** Successful GETs are cached for this long. 0 disables the cache. */
  cacheTtlMs?: number;
  /** Minimum gap between requests, to stay inside a provider's rate limit. */
  minIntervalMs?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

interface CacheEntry {
  at: number;
  value: unknown;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * The single way this app talks to an HTTP data provider.
 *
 * Live market data means someone else's server on the other end of a flaky
 * network, so every call gets: a timeout, bounded retries with backoff that
 * honours Retry-After, a short TTL cache, de-duplication of identical in-flight
 * requests, and a minimum gap between calls to respect rate limits. Modules
 * never see any of this — they see a provider interface.
 */
export class HttpClient {
  private baseUrl: string;
  private timeoutMs: number;
  private retries: number;
  private cacheTtlMs: number;
  private minIntervalMs: number;
  private headers: Record<string, string>;
  private fetchImpl: typeof fetch;
  private now: () => number;

  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<unknown>>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, '') ?? '';
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retries = options.retries ?? 2;
    this.cacheTtlMs = options.cacheTtlMs ?? 10_000;
    this.minIntervalMs = options.minIntervalMs ?? 0;
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.now = options.now ?? (() => Date.now());
  }

  private url(path: string): string {
    if (/^https?:\/\//.test(path)) return path;
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async getJson<T>(path: string, options: { cacheTtlMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    const url = this.url(path);
    const ttl = options.cacheTtlMs ?? this.cacheTtlMs;

    const cached = this.cache.get(url);
    if (cached && ttl > 0 && this.now() - cached.at < ttl) return cached.value as T;

    // Two modules asking for the same thing in the same tick make one request.
    const existing = this.inFlight.get(url);
    if (existing) return existing as Promise<T>;

    const request = this.schedule(() => this.fetchWithRetry<T>(url, options.signal))
      .then((value) => {
        if (ttl > 0) this.cache.set(url, { at: this.now(), value });
        return value;
      })
      .finally(() => {
        this.inFlight.delete(url);
      });

    this.inFlight.set(url, request);
    return request;
  }

  /** Serialise requests so a provider's rate limit is respected. */
  private schedule<T>(task: () => Promise<T>): Promise<T> {
    if (this.minIntervalMs <= 0) return task();
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.minIntervalMs - this.now();
      if (wait > 0) await delay(wait);
      this.lastRequestAt = this.now();
      return task();
    });
    // Keep the chain alive even when one request rejects.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async fetchWithRetry<T>(url: string, signal?: AbortSignal): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort);

      try {
        const response = await this.fetchImpl(url, {
          headers: { accept: 'application/json', ...this.headers },
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = new HttpError(response.status, url);
          if (!RETRYABLE.has(response.status) || attempt === this.retries) throw error;
          await delay(this.backoff(attempt, response.headers.get('retry-after')));
          lastError = error;
          continue;
        }

        return (await response.json()) as T;
      } catch (err) {
        lastError = err;
        // The response branch above already decided whether a status is worth
        // retrying; an HttpError reaching here is final.
        if (err instanceof HttpError) throw err;
        // A caller-cancelled request is not a failure to retry either.
        if (signal?.aborted) throw err;
        if (attempt === this.retries) throw err;
        await delay(this.backoff(attempt, null));
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /** Exponential backoff with jitter, unless the server named a delay. */
  private backoff(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
    }
    const base = Math.min(2 ** attempt * 300, 5_000);
    return base + Math.random() * 200;
  }

  invalidate(path?: string): void {
    if (!path) {
      this.cache.clear();
      return;
    }
    this.cache.delete(this.url(path));
  }

  /** Diagnostics for the settings screen. */
  stats(): { cached: number; inFlight: number } {
    return { cached: this.cache.size, inFlight: this.inFlight.size };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
