import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { readEnv } from '../env';

/**
 * The session lives in cookies the browser cannot read: nothing on the client
 * talks to Supabase, so there is no reason for page scripts to see the tokens.
 */
export const hardenedCookie = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
});

export type Backend = { ok: true; supabase: SupabaseClient } | { ok: false; problems: string[] };

/** A Supabase client acting as the current visitor, or the list of missing settings. */
export async function createBackend(): Promise<Backend> {
  // Read the cookies first, even when the settings turn out to be missing. That marks every page that
  // asks for the backend as per-request. Otherwise a build made without the settings would bake the
  // "not connected" screen into static pages and keep serving it after the settings are added.
  const store = await cookies();
  const env = readEnv();
  if (!env.ok) return env;

  const supabase = createServerClient(env.supabaseUrl, env.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, { ...options, ...hardenedCookie() });
        } catch {
          // A Server Component cannot set cookies; middleware refreshes the session on every request instead.
        }
      },
    },
  });
  return { ok: true, supabase };
}
