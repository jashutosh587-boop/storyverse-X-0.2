import { getCatalogStats } from '@/lib/api/catalog';
import { createAnonBackend } from '@/lib/supabase/anon';

/**
 * For uptime monitors and load balancers: 200 when the site can reach its
 * database, 503 when it cannot. It never says why (no host names, no messages)
 * and is never cached, so a monitor always sees the current state.
 */
export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store' };

export async function GET() {
  const backend = createAnonBackend();
  if (!backend.ok) return Response.json({ status: 'not_configured' }, { status: 503, headers: HEADERS });

  try {
    await getCatalogStats(backend.supabase);
    return Response.json({ status: 'ok' }, { headers: HEADERS });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers: HEADERS });
  }
}
