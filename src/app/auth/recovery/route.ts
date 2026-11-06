import { getBackend } from '@/lib/data';

/**
 * Where the link in a password-reset email lands. It trades the one-time code for
 * a session, then sends the visitor to choose a new password. A link that cannot
 * be used (expired, already used, or opened in a browser other than the one that
 * asked for it) goes back to the request form with an explanation.
 */
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code');
  const go = (location: string) => new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'private, no-store' } });
  const failed = '/forgot-password?error=link';

  const backend = await getBackend();
  if (!backend.ok || !code) return go(failed);

  const { error } = await backend.supabase.auth.exchangeCodeForSession(code);
  return go(error ? failed : '/reset-password');
}
