import { describe, expect, it, vi } from 'vitest';
import { JsonRpcClient, JsonRpcError } from '../chain/JsonRpcClient';
import {
  decodeAddress,
  decodeAmounts,
  decodeReserves,
  encodeGetAmountsOut,
  encodeGetPair,
  encodeGetReserves,
} from '../chain/abi';

function rpcResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A node that answers every id in a batch with the supplied result. */
function node(result: unknown) {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body));
    const requests = Array.isArray(payload) ? payload : [payload];
    const answers = requests.map((request: { id: number; method: string }, index: number) => ({
      jsonrpc: '2.0',
      id: request.id,
      result: typeof result === 'function' ? (result as (m: string, i: number) => unknown)(request.method, index) : result,
    }));
    return rpcResponse(Array.isArray(payload) ? answers : answers[0]);
  });
}

describe('JsonRpcClient', () => {
  it('sends a single call as one object, not a batch', async () => {
    const fetchImpl = node('0x10');
    const client = new JsonRpcClient({ endpoints: ['https://a.rpc'], fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.blockNumber()).resolves.toBe(16);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(Array.isArray(body)).toBe(false);
    expect(body.method).toBe('eth_blockNumber');
  });

  it('batches many calls into a single request and preserves order', async () => {
    const fetchImpl = node((_method: string, index: number) => `0x${index}`);
    const client = new JsonRpcClient({ endpoints: ['https://a.rpc'], fetchImpl: fetchImpl as unknown as typeof fetch });
    const results = await client.callMany([
      { to: '0x1', data: '0xaa' },
      { to: '0x2', data: '0xbb' },
      { to: '0x3', data: '0xcc' },
    ]);
    expect(results).toEqual(['0x0', '0x1', '0x2']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('splits oversized batches across requests', async () => {
    const fetchImpl = node('0x1');
    const client = new JsonRpcClient({
      endpoints: ['https://a.rpc'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxBatchSize: 2,
    });
    await client.callMany(new Array(5).fill({ to: '0x1', data: '0xaa' }));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('fails over to the next endpoint and marks the bad one unhealthy', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('dead')) throw new Error('ECONNREFUSED');
      const payload = JSON.parse(String(init?.body));
      return rpcResponse({ jsonrpc: '2.0', id: payload.id, result: '0x2a' });
    });
    const client = new JsonRpcClient({
      endpoints: ['https://dead.rpc', 'https://good.rpc'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.blockNumber()).resolves.toBe(42);
    const health = client.getHealth();
    expect(health.find((entry) => entry.url.includes('dead'))?.healthy).toBe(false);
    expect(health.find((entry) => entry.url.includes('good'))?.healthy).toBe(true);
  });

  it('throws when every endpoint is down', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network unreachable');
    });
    const client = new JsonRpcClient({
      endpoints: ['https://a.rpc', 'https://b.rpc'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.blockNumber()).rejects.toThrow('network unreachable');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports empty slots rather than throwing when a read batch fails entirely', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    });
    const client = new JsonRpcClient({
      endpoints: ['https://a.rpc'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.callMany([{ to: '0x1', data: '0xaa' }])).resolves.toEqual([null]);
  });

  it('surfaces a contract revert without blaming the endpoint', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      const requests = Array.isArray(payload) ? payload : [payload];
      return rpcResponse(
        requests.map((request) => ({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: 3, message: 'execution reverted' },
        })),
      );
    });
    const client = new JsonRpcClient({
      endpoints: ['https://a.rpc'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.batch([{ method: 'eth_call' }])).rejects.toBeInstanceOf(JsonRpcError);
    // The endpoint answered correctly; it must not be marked unhealthy.
    expect(client.getHealth()[0]?.healthy).toBe(true);
  });

  it('pins reads to a block when one is given', async () => {
    const fetchImpl = node('0x1');
    const client = new JsonRpcClient({ endpoints: ['https://a.rpc'], fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.callMany([{ to: '0x1', data: '0xaa' }], 1234);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(body.params[1]).toBe('0x4d2');
  });
});

describe('AMM call encoding', () => {
  const HEX = '0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39';
  const WPLS = '0xA1077a294dDE1B09bB078844df40758a5D0f9a27';

  it('encodes getPair with both addresses padded to words', () => {
    const data = encodeGetPair(HEX, WPLS);
    expect(data.startsWith('0xe6a43905')).toBe(true);
    expect(data).toHaveLength(2 + 8 + 64 + 64);
    expect(data.toLowerCase()).toContain(HEX.slice(2).toLowerCase());
  });

  it('encodes getReserves as a bare selector', () => {
    expect(encodeGetReserves()).toBe('0x0902f1ac');
  });

  it('encodes getAmountsOut with a dynamic path array', () => {
    const data = encodeGetAmountsOut(1000n, [HEX, WPLS]);
    expect(data.startsWith('0xd06ca61f')).toBe(true);
    // selector + amount + offset + length + 2 addresses
    expect(data).toHaveLength(2 + 8 + 64 * 5);
    // Offset points past the two head words.
    expect(data.slice(10 + 64, 10 + 128)).toBe((64).toString(16).padStart(64, '0'));
  });

  it('decodes reserves into both sides and a timestamp', () => {
    const hex =
      '0x' +
      (12345n).toString(16).padStart(64, '0') +
      (67890n).toString(16).padStart(64, '0') +
      (1700000000n).toString(16).padStart(64, '0');
    expect(decodeReserves(hex)).toEqual({
      reserve0: 12345n,
      reserve1: 67890n,
      blockTimestampLast: 1700000000,
    });
  });

  it('returns null for a truncated reserves payload', () => {
    expect(decodeReserves('0x')).toBeNull();
  });

  it('decodes an address and treats the zero address as absent', () => {
    const padded = '0x' + WPLS.slice(2).toLowerCase().padStart(64, '0');
    expect(decodeAddress(padded)?.toLowerCase()).toBe(WPLS.toLowerCase());
    expect(decodeAddress('0x' + '0'.repeat(64))).toBeNull();
  });

  it('decodes a getAmountsOut result array', () => {
    const hex =
      '0x' +
      (32n).toString(16).padStart(64, '0') +
      (2n).toString(16).padStart(64, '0') +
      (1000n).toString(16).padStart(64, '0') +
      (1980n).toString(16).padStart(64, '0');
    expect(decodeAmounts(hex)).toEqual([1000n, 1980n]);
  });
});
