import { z } from 'zod';

/**
 * Server configuration. Everything the web app needs to reach its database is
 * here, and none of it is exposed to the browser: the app talks to Supabase from
 * the server only, so these variables deliberately have no NEXT_PUBLIC_ prefix.
 */
const schema = z.object({
  SUPABASE_URL: z.string({ required_error: 'is not set' }).url('is not a valid URL'),
  SUPABASE_ANON_KEY: z.string({ required_error: 'is not set' }).min(20, 'looks too short to be a key'),
  SITE_URL: z.string().url('is not a valid URL').optional(),
});

export type AppEnv =
  | { ok: true; supabaseUrl: string; anonKey: string; siteUrl: string | undefined }
  | { ok: false; problems: string[] };

const blankToUndefined = (value: string | undefined) => (value && value.trim() !== '' ? value.trim() : undefined);

/** Validate the environment. Problems never include the offending value. */
export function readEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = schema.safeParse({
    SUPABASE_URL: blankToUndefined(source.SUPABASE_URL),
    SUPABASE_ANON_KEY: blankToUndefined(source.SUPABASE_ANON_KEY),
    SITE_URL: blankToUndefined(source.SITE_URL),
  });
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((issue) => `${String(issue.path[0])} ${issue.message}`) };
  }
  return {
    ok: true,
    supabaseUrl: parsed.data.SUPABASE_URL.replace(/\/+$/, ''),
    anonKey: parsed.data.SUPABASE_ANON_KEY,
    siteUrl: parsed.data.SITE_URL?.replace(/\/+$/, ''),
  };
}
