import Link from 'next/link';
import { SearchBox } from '@/components/search-box';
import { EmptyState, SetupRequired } from '@/components/states';
import { TitleGrid } from '@/components/title-card';
import { getCatalogStats, searchTitles } from '@/lib/api/catalog';
import { CATEGORIES } from '@/lib/categories';
import { getBackend } from '@/lib/data';
import type { RawSearchParams } from '@/lib/browse-params';

export default async function HomePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const backend = await getBackend();
  if (!backend.ok) return <SetupRequired problems={backend.problems} />;

  const deleted = (await searchParams).account === 'deleted';
  const [stats, popular, topRated] = await Promise.all([
    getCatalogStats(backend.supabase),
    searchTitles(backend.supabase, { sort: 'popularity', limit: 12 }),
    searchTitles(backend.supabase, { sort: 'score', minScore: 0.1, limit: 12 }),
  ]);

  return (
    <>
      <section className="shell pb-10 pt-14 md:pt-20">
        {deleted ? (
          <p role="status" className="notice mb-8 max-w-xl">
            Your account and everything attached to it has been deleted.
          </p>
        ) : null}
        <h1 className="display max-w-3xl text-5xl md:text-7xl">Find your next story</h1>
        <p className="mt-4 max-w-xl text-lg text-muted">
          One catalog for anime, film, TV, books, novels and manga, with the links between them.
        </p>
        <div className="mt-8 max-w-2xl">
          <SearchBox large />
        </div>
        <ul aria-label="Browse by category" className="mt-6 flex flex-wrap gap-2">
          {CATEGORIES.map((category) => {
            const count = category.mediaTypes.reduce((sum, type) => sum + (stats.by_type[type] ?? 0), 0);
            return (
              <li key={category.slug}>
                <Link href={`/${category.slug}`} className="chip">
                  {category.label}
                  <span className="tnum text-muted">{count.toLocaleString('en-US')}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {stats.total === 0 ? (
        <section className="shell mt-6">
          <EmptyState title="The catalog is empty">
            <p>Titles are imported from outside providers, so a new catalog starts with none. Nothing here is placeholder content.</p>
            <p className="text-sm">
              Site owner: run <code>npm run ingest -- jikan anime --pages 2</code> to add titles. <code>docs/DEPLOYMENT.md</code> explains the
              providers and their keys.
            </p>
          </EmptyState>
        </section>
      ) : (
        <>
          <section aria-labelledby="popular" className="shell mt-6">
            <div className="mb-5 flex items-baseline justify-between gap-4">
              <h2 id="popular" className="display text-3xl">
                Popular right now
              </h2>
              <Link href="/search" className="link text-sm">
                Browse everything
              </Link>
            </div>
            <TitleGrid titles={popular.items} label="Popular titles" />
          </section>

          {topRated.items.length > 0 ? (
            <section aria-labelledby="top-rated" className="shell mt-14">
              <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id="top-rated" className="display text-3xl">
                  Highest rated
                </h2>
                <p className="text-sm text-muted">
                  Ranked by the data sources&apos; scores, weighted by how many ratings each has.{' '}
                  <Link href="/about" className="link">
                    How scores work
                  </Link>
                </p>
              </div>
              <TitleGrid titles={topRated.items} label="Highest rated titles" />
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
