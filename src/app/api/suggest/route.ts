import { suggestTitles } from '@/lib/api/catalog';
import { createAnonBackend } from '@/lib/supabase/anon';

// The same answer for everyone, so it may be shared by caches for a short while.
const CACHEABLE = { 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300' };
const NOT_CACHEABLE = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 100);
  if (q.length < 2) return Response.json([], { headers: CACHEABLE });

  const backend = createAnonBackend();
  if (!backend.ok) return Response.json([], { status: 503, headers: NOT_CACHEABLE });

  try {
    return Response.json(await suggestTitles(backend.supabase, q, 8), { headers: CACHEABLE });
  } catch {
    return Response.json([], { status: 502, headers: NOT_CACHEABLE });
  }
}
