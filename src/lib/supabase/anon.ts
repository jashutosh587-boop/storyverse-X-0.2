import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readEnv } from '../env';

/**
 * A Supabase client with no visitor attached, for public data that is the same
 * for everyone (title suggestions). It sends no cookies, so its answers can be
 * cached by a CDN.
 */
export function createAnonBackend(): { ok: true; supabase: SupabaseClient } | { ok: false } {
  const env = readEnv();
  if (!env.ok) return { ok: false };
  return {
    ok: true,
    supabase: createClient(env.supabaseUrl, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}
