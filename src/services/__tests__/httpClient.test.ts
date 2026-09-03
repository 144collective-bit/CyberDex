import { describe, expect, it, vi } from 'vitest';
import { HttpClient, HttpError } from '../http/HttpClient';

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('HttpClient', () => {
  it('resolves JSON and builds urls from the base', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      seen.push(String(url));
      return jsonResponse({ ok: true });
    });
    const client = new HttpClient({ baseUrl: 'https://api.test/v2/', fetchImpl: fetchImpl as unknown as typeof fetch, cacheTtlMs: 0 });
    await expect(client.getJson('/prices')).resolves.toEqual({ ok: true });
    expect(seen[0]).toBe('https://api.test/v2/prices');
  });

  it('serves a repeat request from cache within the TTL', async () => {
    let now = 1000;
    const fetchImpl = vi.fn(async () => jsonResponse({ n: 1 }));
    const client = new HttpClient({ fetchImpl, cacheTtlMs: 5000, now: () => now });
    await client.getJson('https://api.test/a');
    await client.getJson('https://api.test/a');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 6000;
    await client.getJson('https://api.test/a');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates identical requests that are in flight together', async () => {
    let release: (value: Response) => void = () => undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const client = new HttpClient({ fetchImpl, cacheTtlMs: 0 });
    const a = client.getJson('https://api.test/b');
    const b = client.getJson('https://api.test/b');
    release(jsonResponse({ n: 2 }));
    await expect(a).resolves.toEqual({ n: 2 });
    await expect(b).resolves.toEqual({ n: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 503 and then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ recovered: true }));
    const client = new HttpClient({ fetchImpl, cacheTtlMs: 0, retries: 2 });
    await expect(client.getJson('https://api.test/c')).resolves.toEqual({ recovered: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404 and reports the status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 404 }));
    const client = new HttpClient({ fetchImpl, cacheTtlMs: 0, retries: 3 });
    await expect(client.getJson('https://api.test/d')).rejects.toBeInstanceOf(HttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget and surfaces the failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const client = new HttpClient({ fetchImpl, cacheTtlMs: 0, retries: 1 });
    await expect(client.getJson('https://api.test/e')).rejects.toThrow('network down');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('honours a Retry-After header', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new HttpClient({ fetchImpl, cacheTtlMs: 0 });
    await expect(client.getJson('https://api.test/f')).resolves.toEqual({ ok: true });
  });

  it('times out a request that never answers', async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const client = new HttpClient({ fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 5, retries: 0, cacheTtlMs: 0 });
    await expect(client.getJson('https://api.test/g')).rejects.toThrow(/abort/i);
  });

  it('spaces requests by the configured minimum interval', async () => {
    const stamps: number[] = [];
    const fetchImpl = vi.fn(async () => {
      stamps.push(Date.now());
      return jsonResponse({});
    });
    const client = new HttpClient({ fetchImpl, cacheTtlMs: 0, minIntervalMs: 40 });
    await Promise.all([
      client.getJson('https://api.test/h1'),
      client.getJson('https://api.test/h2'),
      client.getJson('https://api.test/h3'),
    ]);
    expect(stamps).toHaveLength(3);
    expect(stamps[2]! - stamps[0]!).toBeGreaterThanOrEqual(70);
  });

  it('keeps serialising after a failed request', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(jsonResponse({ ok: true }));
    const client = new HttpClient({ fetchImpl, cacheTtlMs: 0, retries: 0, minIntervalMs: 5 });
    await expect(client.getJson('https://api.test/i1')).rejects.toThrow('boom');
    await expect(client.getJson('https://api.test/i2')).resolves.toEqual({ ok: true });
  });

  it('drops cached entries on demand', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ n: 1 }));
    const client = new HttpClient({ fetchImpl, cacheTtlMs: 60_000 });
    await client.getJson('https://api.test/j');
    client.invalidate('https://api.test/j');
    await client.getJson('https://api.test/j');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
