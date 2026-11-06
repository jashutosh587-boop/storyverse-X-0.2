import { getBackend } from '@/lib/data';
import { safeNext } from '@/lib/safe-next';

/**
 * Where the link in a confirmation email lands. It trades the one-time code for
 * a session, then sends the visitor on. The Location is a plain path, so the
 * browser resolves it against the address it used, whatever sits in front of us.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const go = (location: string) => new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'private, no-store' } });

  const backend = await getBackend();
  if (!backend.ok || !code) return go('/login?error=callback');

  const { error } = await backend.supabase.auth.exchangeCodeForSession(code);
  if (error) return go('/login?error=callback');
  return go(safeNext(url.searchParams.get('next'), '/'));
}
