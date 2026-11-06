import { exportMyData } from '@/lib/api/profile';
import { getBackend, getCurrentUser } from '@/lib/data';

// Personal data: never cache it, in the browser or anywhere between.
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  const backend = await getBackend();
  if (!backend.ok) return Response.json({ error: 'not_configured' }, { status: 503, headers: NO_STORE });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'not_authenticated' }, { status: 401, headers: NO_STORE });

  try {
    const data = await exportMyData(backend.supabase);
    const day = new Date().toISOString().slice(0, 10);
    // The email address lives with the sign-in service, not in the database, so it is added here.
    const everything = { account: { email: user.email ?? null, created_at: user.created_at }, ...data };
    return new Response(JSON.stringify(everything, null, 2), {
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="storyverse-export-${day}.json"`,
      },
    });
  } catch {
    return Response.json({ error: 'unavailable' }, { status: 502, headers: NO_STORE });
  }
}
