import { describe, expect, it } from 'vitest';
import { readEnv } from '@/lib/env';

const KEY = 'a'.repeat(40);

describe('readEnv', () => {
  it('accepts a complete configuration and tidies it', () => {
    const env = readEnv({ SUPABASE_URL: ' https://abc.supabase.co/// ', SUPABASE_ANON_KEY: ` ${KEY} `, SITE_URL: 'https://example.com/' });
    expect(env).toEqual({ ok: true, supabaseUrl: 'https://abc.supabase.co', anonKey: KEY, siteUrl: 'https://example.com' });
  });

  it('treats SITE_URL as optional', () => {
    const env = readEnv({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: KEY });
    expect(env).toMatchObject({ ok: true, siteUrl: undefined });
  });

  it('lists every missing setting by name', () => {
    expect(readEnv({})).toEqual({ ok: false, problems: ['SUPABASE_URL is not set', 'SUPABASE_ANON_KEY is not set'] });
  });

  it('treats blank values as missing', () => {
    const env = readEnv({ SUPABASE_URL: '   ', SUPABASE_ANON_KEY: '', SITE_URL: '' });
    expect(env).toEqual({ ok: false, problems: ['SUPABASE_URL is not set', 'SUPABASE_ANON_KEY is not set'] });
  });

  it('rejects values that are not URLs or look too short', () => {
    const env = readEnv({ SUPABASE_URL: 'not-a-url', SUPABASE_ANON_KEY: 'short', SITE_URL: 'nope' });
    expect(env).toEqual({
      ok: false,
      problems: ['SUPABASE_URL is not a valid URL', 'SUPABASE_ANON_KEY looks too short to be a key', 'SITE_URL is not a valid URL'],
    });
  });

  it('never repeats a value in its problems, because they are shown on the setup screen', () => {
    const env = readEnv({ SUPABASE_URL: 'secret-url-value', SUPABASE_ANON_KEY: 'secret-key', SITE_URL: 'secret-site' });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.problems.join(' ')).not.toMatch(/secret/);
  });
});
