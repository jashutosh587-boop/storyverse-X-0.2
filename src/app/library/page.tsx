import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LibraryList } from '@/components/library-list';
import { Pagination } from '@/components/pagination';
import { EmptyState, SetupRequired } from '@/components/states';
import { listLibrary } from '@/lib/api/library';
import { LIBRARY_STATUSES, type LibraryStatus } from '@/lib/api/schemas';
import type { RawSearchParams } from '@/lib/browse-params';
import { getBackend, getCurrentUser } from '@/lib/data';
import { libraryStatusLabel } from '@/lib/format';

export const metadata: Metadata = { title: 'Your library', robots: { index: false } };

const PAGE_SIZE = 48;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LibraryPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const backend = await getBackend();
  if (!backend.ok) return <SetupRequired problems={backend.problems} />;
  if (!(await getCurrentUser())) redirect('/login?next=%2Flibrary');

  const raw = await searchParams;
  const status = LIBRARY_STATUSES.find((s) => s === first(raw.status));
  const pageText = first(raw.page);
  const page = pageText && /^\d{1,4}$/.test(pageText) ? Math.max(1, Number(pageText)) : 1;

  const result = await listLibrary(backend.supabase, { status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const hrefFor = (target: number) => {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (target > 1) query.set('page', String(target));
    const text = query.toString();
    return `/library${text ? `?${text}` : ''}`;
  };
  if (page > totalPages) redirect(hrefFor(totalPages));

  const everything = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
  const tabs: Array<{ status: LibraryStatus | undefined; label: string; count: number }> = [
    { status: undefined, label: 'All', count: everything },
    ...LIBRARY_STATUSES.map((s) => ({ status: s, label: libraryStatusLabel(s), count: result.counts[s] ?? 0 })).filter(
      (tab) => tab.count > 0 || tab.status === status,
    ),
  ];
  return (
    <div className="shell py-10">
      <h1 className="display text-5xl md:text-6xl">Your library</h1>

      {everything === 0 ? (
        <div className="mt-8">
          <EmptyState title="Your library is empty">
            <p>
              Open any title and choose <strong className="font-semibold text-text">Add to library</strong> to start tracking it.
            </p>
            <p>
              <Link href="/search" className="link">
                Browse the catalog
              </Link>
            </p>
          </EmptyState>
        </div>
      ) : (
        <>
          <nav aria-label="Filter by status" className="mt-6 flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <Link
                key={tab.label}
                href={tab.status ? `/library?status=${tab.status}` : '/library'}
                className="chip"
                aria-current={tab.status === status ? 'true' : undefined}
              >
                {tab.label}
                <span className="tnum text-muted">{tab.count}</span>
              </Link>
            ))}
          </nav>

          <div className="mt-6">
            {result.items.length > 0 ? (
              <LibraryList items={result.items} />
            ) : (
              <EmptyState title="Nothing with that status">
                <p>
                  <Link href="/library" className="link">
                    Show your whole library
                  </Link>
                </p>
              </EmptyState>
            )}
          </div>
          <Pagination page={page} totalPages={totalPages} hrefFor={hrefFor} />
        </>
      )}
    </div>
  );
}
