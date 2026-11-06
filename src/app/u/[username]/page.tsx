import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { LibraryList } from '@/components/library-list';
import { Pagination } from '@/components/pagination';
import { EmptyState, SetupRequired } from '@/components/states';
import { listLibrary } from '@/lib/api/library';
import { getProfile } from '@/lib/api/profile';
import { LIBRARY_STATUSES, type LibraryStatus } from '@/lib/api/schemas';
import type { RawSearchParams } from '@/lib/browse-params';
import { getBackend } from '@/lib/data';
import { formatMonth, libraryStatusLabel } from '@/lib/format';

type Props = { params: Promise<{ username: string }>; searchParams: Promise<RawSearchParams> };

const PAGE_SIZE = 48;
const USERNAME = /^[A-Za-z0-9_]{3,24}$/;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { username } = await params;
  // Profiles can be turned off, so a profile page is never offered to search engines.
  return { title: `@${username}`, robots: { index: false } };
}

export default async function ProfilePage({ params, searchParams }: Props) {
  const { username } = await params;
  if (!USERNAME.test(username)) notFound();

  const backend = await getBackend();
  if (!backend.ok) return <SetupRequired problems={backend.problems} />;

  // The database returns nothing for a private profile that is not yours, so "private" and "does not exist" look the same.
  const profile = await getProfile(backend.supabase, username);
  if (!profile) notFound();

  const raw = await searchParams;
  const status = LIBRARY_STATUSES.find((s) => s === first(raw.status));
  const pageText = first(raw.page);
  const page = pageText && /^\d{1,4}$/.test(pageText) ? Math.max(1, Number(pageText)) : 1;
  const result = await listLibrary(backend.supabase, { userId: profile.id, status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });

  const base = `/u/${profile.username}`;
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const everything = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
  const tabs: Array<{ status: LibraryStatus | undefined; label: string; count: number }> = [
    { status: undefined, label: 'All', count: everything },
    ...LIBRARY_STATUSES.map((s) => ({ status: s, label: libraryStatusLabel(s), count: result.counts[s] ?? 0 })).filter((t) => t.count > 0 || t.status === status),
  ];
  const hrefFor = (target: number) => {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (target > 1) query.set('page', String(target));
    const text = query.toString();
    return `${base}${text ? `?${text}` : ''}`;
  };
  if (page > totalPages) redirect(hrefFor(totalPages));

  return (
    <div className="shell py-10">
      <header className="max-w-2xl">
        <h1 className="display text-5xl md:text-6xl">{profile.display_name || profile.username}</h1>
        <p className="mt-1 text-muted">
          @{profile.username}, member since {formatMonth(profile.created_at)}
        </p>
        {profile.bio ? <p className="mt-4 whitespace-pre-line">{profile.bio}</p> : null}
        {profile.is_self ? (
          <p className="notice mt-5 text-sm">
            {profile.is_public
              ? 'Other people see this page without your notes and without the entries marked Private.'
              : 'Your profile is private, so only you can see this page.'}{' '}
            <Link href="/settings" className="link">
              Change your profile settings
            </Link>
          </p>
        ) : null}
      </header>

      <section aria-labelledby="library-heading" className="mt-10">
        <h2 id="library-heading" className="display text-3xl">
          Library
        </h2>
        {everything === 0 ? (
          <div className="mt-4">
            <EmptyState title={profile.is_self ? 'Your library is empty' : 'Nothing to show yet'}>
              <p>
                {profile.is_self
                  ? 'Titles you add appear here, except the ones you mark private.'
                  : `${profile.display_name || profile.username} has not shared any library entries.`}
              </p>
            </EmptyState>
          </div>
        ) : (
          <>
            <nav aria-label="Filter by status" className="mt-4 flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <Link
                  key={tab.label}
                  href={tab.status ? `${base}?status=${tab.status}` : base}
                  className="chip"
                  aria-current={tab.status === status ? 'true' : undefined}
                >
                  {tab.label}
                  <span className="tnum text-muted">{tab.count}</span>
                </Link>
              ))}
            </nav>
            <div className="mt-6">
              <LibraryList items={result.items} />
            </div>
            <Pagination page={page} totalPages={totalPages} hrefFor={hrefFor} />
          </>
        )}
      </section>
    </div>
  );
}
