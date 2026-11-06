import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The route imports a module that refuses to load outside the server build.
vi.mock('server-only', () => ({}));

const KEY = 'k'.repeat(40);

async function callHealth() {
  const { GET } = await import('@/app/api/health/route');
  const response = await GET();
  return { status: response.status, body: await response.json(), headers: response.headers };
}

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('says "not configured" with a 503 when the site has no database settings', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    const { status, body, headers } = await callHealth();
    expect(status).toBe(503);
    expect(body).toEqual({ status: 'not_configured' });
    expect(headers.get('cache-control')).toBe('no-store');
  });

  it('says ok when the database answers a real query', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example-project.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', KEY);
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(JSON.stringify({ total: 3, by_type: { anime: 3 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const { status, body } = await callHealth();
    expect(status).toBe(200);
    expect(body).toEqual({ status: 'ok' });
    expect(asked).toEqual(['https://example-project.supabase.co/rest/v1/rpc/catalog_stats']);
  });

  it('says unavailable, and nothing about why, when the database cannot be reached', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://db.internal.example');
    vi.stubEnv('SUPABASE_ANON_KEY', KEY);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed: connect ECONNREFUSED db.internal.example:5432 password authentication failed');
    });
    const { status, body, headers } = await callHealth();
    expect(status).toBe(503);
    expect(body).toEqual({ status: 'unavailable' });
    expect(headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(body)).not.toMatch(/internal|ECONNREFUSED|password/);
  });

  it('says unavailable when the database answers with something unexpected', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example-project.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', KEY);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ unexpected: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const { status, body } = await callHealth();
    expect(status).toBe(503);
    expect(body).toEqual({ status: 'unavailable' });
  });
});
