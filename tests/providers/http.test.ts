import { describe, expect, it } from 'vitest';
import { createHttpClient, ProviderHttpError, parseRetryAfter } from '@/lib/providers/http';

/** A fake clock: sleeping advances time instantly and records the wait. */
function clock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

function scripted(responses: Array<Response | Error>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('createHttpClient', () => {
  it('returns parsed JSON and identifies itself', async () => {
    const { fetchImpl, calls } = scripted([json({ ok: true })]);
    const c = clock();
    const http = createHttpClient({ userAgent: 'Test/1 (me@example.test)', fetchImpl, ...c, headers: { Authorization: 'Bearer x' } });
    await expect(http.getJson('https://api.test/a')).resolves.toEqual({ ok: true });
    expect(calls[0]!.headers['User-Agent']).toBe('Test/1 (me@example.test)');
    expect(calls[0]!.headers['Authorization']).toBe('Bearer x');
  });

  it('retries 429 and 5xx with exponential backoff, then succeeds', async () => {
    const { fetchImpl, calls } = scripted([new Response('', { status: 503 }), new Response('', { status: 429 }), json({ n: 1 })]);
    const c = clock();
    const http = createHttpClient({ userAgent: 'T', fetchImpl, ...c, baseDelayMs: 1000, random: () => 0 });
    await expect(http.getJson('https://api.test/a')).resolves.toEqual({ n: 1 });
    expect(calls).toHaveLength(3);
    expect(c.sleeps).toEqual([1000, 2000]);
  });

  it('honours Retry-After over its own backoff', async () => {
    const { fetchImpl } = scripted([new Response('', { status: 429, headers: { 'retry-after': '7' } }), json({})]);
    const c = clock();
    const http = createHttpClient({ userAgent: 'T', fetchImpl, ...c, random: () => 0 });
    await http.getJson('https://api.test/a');
    expect(c.sleeps).toEqual([7000]);
  });

  it('gives up after maxRetries with a typed error', async () => {
    const { fetchImpl, calls } = scripted(Array.from({ length: 10 }, () => new Response('', { status: 500 })));
    const http = createHttpClient({ userAgent: 'T', fetchImpl, ...clock(), maxRetries: 2, random: () => 0 });
    const err = (await http.getJson('https://api.test/a').catch((e: unknown) => e)) as ProviderHttpError;
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err.status).toBe(500);
    expect(calls).toHaveLength(3);
  });

  it('does not retry client errors', async () => {
    const { fetchImpl, calls } = scripted([new Response('', { status: 404 })]);
    const http = createHttpClient({ userAgent: 'T', fetchImpl, ...clock() });
    await expect(http.getJson('https://api.test/missing')).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(1);
  });

  it('retries network failures and reports them as status 0 when they persist', async () => {
    const ok = scripted([new Error('socket hang up'), json({ fine: true })]);
    await expect(createHttpClient({ userAgent: 'T', fetchImpl: ok.fetchImpl, ...clock(), random: () => 0 }).getJson('https://api.test/a')).resolves.toEqual({ fine: true });

    const bad = scripted([new Error('down'), new Error('down'), new Error('down')]);
    const err = await createHttpClient({ userAgent: 'T', fetchImpl: bad.fetchImpl, ...clock(), maxRetries: 2, random: () => 0 })
      .getJson('https://api.test/a')
      .catch((e) => e);
    expect(err).toMatchObject({ status: 0 });
  });

  it('rejects a 200 response that is not JSON', async () => {
    const { fetchImpl } = scripted([new Response('<html>', { status: 200 })]);
    await expect(createHttpClient({ userAgent: 'T', fetchImpl, ...clock() }).getJson('https://api.test/a')).rejects.toThrow(/not valid JSON/);
  });

  it('spaces requests by the minimum interval, even when started together', async () => {
    const starts: number[] = [];
    const c = clock();
    const fetchImpl = (async () => {
      starts.push(c.now());
      return json({});
    }) as unknown as typeof fetch;
    const http = createHttpClient({ userAgent: 'T', fetchImpl, ...c, minIntervalMs: 1100 });
    await Promise.all([http.getJson('https://api.test/1'), http.getJson('https://api.test/2'), http.getJson('https://api.test/3')]);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1100);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(1100);
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('3', 0)).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter('soon', 0)).toBeUndefined();
    expect(parseRetryAfter(null, 0)).toBeUndefined();
  });
});
