import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { FilterForm } from '@/components/filter-form';
import { Pagination } from '@/components/pagination';
import { EmptyState, SetupRequired } from '@/components/states';
import { TitleGrid } from '@/components/title-card';
import { getFacets, searchTitles } from '@/lib/api/catalog';
import { hasActiveFilters, PAGE_SIZE, parseBrowseParams, toQueryString, toSearchArgs, type RawSearchParams } from '@/lib/browse-params';
import { categoryBySlug } from '@/lib/categories';
import { getBackend } from '@/lib/data';
import { inSentence, statusLabel } from '@/lib/format';

type Props = { params: Promise<{ category: string }>; searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const category = categoryBySlug((await params).category);
  return category ? { title: category.label, description: category.blurb } : {};
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const slug = (await params).category;
  const category = categoryBySlug(slug);
  if (!category) notFound();

  const backend = await getBackend();
  if (!backend.ok) return <SetupRequired problems={backend.problems} />;

  const browse = parseBrowseParams(await searchParams);
  const [result, facets] = await Promise.all([
    searchTitles(backend.supabase, toSearchArgs(browse, category.mediaTypes)),
    getFacets(backend.supabase, category.mediaTypes),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  if (browse.page > totalPages) redirect(`/${slug}${toQueryString(browse, { page: totalPages })}`);

  const base = `/${slug}`;
  const removeFrom = (patch: Parameters<typeof toQueryString>[1]) => `${base}${toQueryString(browse, { ...patch, page: 1 })}`;
  const chips = [
    ...browse.genres.map((genre) => ({ key: `g-${genre}`, label: genre, href: removeFrom({ genres: browse.genres.filter((g) => g !== genre) }) })),
    ...browse.statuses.map((status) => ({ key: `s-${status}`, label: statusLabel(status), href: removeFrom({ statuses: browse.statuses.filter((s) => s !== status) }) })),
    ...(browse.yearFrom !== undefined ? [{ key: 'from', label: `From ${browse.yearFrom}`, href: removeFrom({ yearFrom: undefined }) }] : []),
    ...(browse.yearTo !== undefined ? [{ key: 'to', label: `Up to ${browse.yearTo}`, href: removeFrom({ yearTo: undefined }) }] : []),
    ...(browse.minScore !== undefined ? [{ key: 'min', label: `Score ${browse.minScore}+`, href: removeFrom({ minScore: undefined }) }] : []),
    ...(browse.q ? [{ key: 'q', label: `Title contains “${browse.q}”`, href: removeFrom({ q: undefined }) }] : []),
  ];

  const first = result.offset + 1;
  const last = result.offset + result.items.length;

  return (
    <div className="shell py-10">
      <header className="mb-8">
        <h1 className="display text-5xl md:text-6xl">{category.label}</h1>
        <p className="mt-2 text-muted">{category.blurb}</p>
      </header>

      {facets.total === 0 ? (
        <EmptyState title={`No ${inSentence(category.label)} in the catalog yet`}>
          <p>Titles are imported from outside providers, and none have been imported for this category.</p>
          <p className="text-sm">
            Site owner: see <code>docs/DEPLOYMENT.md</code> for which provider fills this category.
          </p>
        </EmptyState>
      ) : (
        <>
          <FilterForm action={base} params={browse} facets={facets} withQuery open={hasActiveFilters(browse) || Boolean(browse.q)} />

          {chips.length > 0 ? (
            <ul aria-label="Active filters" className="mt-4 flex flex-wrap gap-2">
              {chips.map((chip) => (
                <li key={chip.key}>
                  <Link href={chip.href} className="chip" aria-label={`Remove filter: ${chip.label}`}>
                    {chip.label}
                    <span aria-hidden="true" className="text-muted">
                      ×
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="tnum mt-6 text-sm text-muted" aria-live="polite">
            {result.total === 0
              ? 'No titles match.'
              : `Showing ${first.toLocaleString('en-US')} to ${last.toLocaleString('en-US')} of ${result.total.toLocaleString('en-US')} titles`}
          </p>

          <div className="mt-4">
            {result.items.length > 0 ? (
              <TitleGrid titles={result.items} label={`${category.label} titles`} />
            ) : (
              <EmptyState title="Nothing matches those filters">
                <p>
                  <Link href={base} className="link">
                    Clear the filters
                  </Link>{' '}
                  to see everything in {category.label}.
                </p>
              </EmptyState>
            )}
          </div>

          <Pagination page={browse.page} totalPages={totalPages} hrefFor={(n) => `${base}${toQueryString(browse, { page: n })}`} />
        </>
      )}
    </div>
  );
}
