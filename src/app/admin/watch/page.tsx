import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LicensedEpisodeForm, WatchProviderForm, type WatchAdminTitle } from '@/components/title/watch-admin-forms';
import { isWatchCatalogAdmin } from '@/lib/api/watch';
import { searchTitles } from '@/lib/api/catalog';
import { getBackend, getCurrentUser } from '@/lib/data';
import { SetupRequired } from '@/components/states';

export const metadata: Metadata = {
  title: 'Watch catalogue manager',
  robots: { index: false, follow: false },
};

const bootstrapSql = `insert into public.watch_catalog_admins (user_id)\nselect id from auth.users\nwhere lower(email) = lower('YOUR_SUPABASE_LOGIN_EMAIL')\non conflict (user_id) do nothing;`;

export default async function WatchAdminPage() {
  const backend = await getBackend();
  if (!backend.ok) return <SetupRequired problems={backend.problems} />;
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=%2Fadmin%2Fwatch');

  const isAdmin = await isWatchCatalogAdmin(backend.supabase).catch(() => false);
  if (!isAdmin) {
    return (
      <div className="shell max-w-3xl py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-violet-soft">Restricted area</p>
        <h1 className="display mt-2 text-5xl">Watch catalogue manager</h1>
        <div className="panel mt-6 space-y-4">
          <p className="font-medium">Your account is not on the watch-catalogue admin list yet.</p>
          <p className="text-sm text-muted">To protect the catalogue, only an account explicitly added by the Supabase project owner can publish provider links or video sources.</p>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Open your Supabase project and select SQL Editor.</li>
            <li>Paste the SQL below, replacing the placeholder with the email address you use to sign in to Storyverse X.</li>
            <li>Run it, then reload this page.</li>
          </ol>
          <pre className="overflow-x-auto rounded-lg border border-line bg-ink p-3 text-xs leading-relaxed">{bootstrapSql}</pre>
          <p className="text-xs text-muted">This is an administrative permission only. It does not expose your Supabase password or service-role key to the browser.</p>
          <Link href="/anime" className="link text-sm">Back to anime catalogue</Link>
        </div>
      </div>
    );
  }

  const result = await searchTitles(backend.supabase, { mediaTypes: ['anime'], sort: 'popularity', limit: 100, offset: 0 });
  const titles: WatchAdminTitle[] = result.items.map((title) => ({
    id: title.id,
    slug: title.slug,
    title: title.title,
    release_year: title.release_year,
  }));

  return (
    <div className="shell py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-violet-soft">Admin · rights-managed catalogue</p>
      <h1 className="display mt-2 text-5xl md:text-6xl">Watch catalogue manager</h1>
      <p className="mt-3 max-w-3xl text-muted">
        Add official streaming destinations and publish direct episodes only when you have the rights to distribute the video. Metadata from the anime catalogue does not include video files or streaming licences.
      </p>
      {titles.length === 0 ? (
        <div className="panel mt-8">No anime titles are available to manage yet. Add catalogue titles first.</div>
      ) : (
        <div className="mt-8 grid items-start gap-6 xl:grid-cols-2">
          <WatchProviderForm titles={titles} />
          <LicensedEpisodeForm titles={titles} />
        </div>
      )}
      <div className="mt-8 rounded-xl border border-line bg-raised p-4 text-sm text-muted">
        <strong className="font-semibold text-text">Publishing safeguards:</strong> provider destinations must use HTTPS. Built-in playback supports licensed MP4 and HLS sources; the stream host must allow browser playback (CORS for HLS). DRM-protected services should be opened on their official platform instead of being embedded here.
      </div>
    </div>
  );
}
