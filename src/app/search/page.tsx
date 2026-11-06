import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FilterForm } from '@/components/filter-form';
import { Pagination } from '@/components/pagination';
import { SearchBox } from '@/components/search-box';
import { EmptyState, SetupRequired } from '@/components/states';
import { TitleGrid } from '@/components/title-card';
import { getFacets, searchTitles } from '@/lib/api/catalog';
import { hasActiveFilters, PAGE_SIZE, parseBrowseParams, toQueryString, toSearchArgs, type RawSearchParams } from '@/lib/browse-params';
import { CATEGORIES, categoryBySlug } from '@/lib/categories';
import { getBackend } from '@/lib/data';
import { inSentence } from '@/lib/format';

type Props = { searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = parseBrowseParams(await searchParams).q;
  return { title: q ? `Results for ${q}` : 'Browse everything', robots: { index: false } };
}

export default async function SearchPage({ searchParams }: Props) {
  const backend = await getBackend();
  if (!backend.ok) return <SetupRequired problems={backend.problems} />;

  const raw = await searchParams;
  const browse = parseBrowseParams(raw);
  const typeParam = Array.isArray(raw.type) ? raw.type[0] : raw.type;
  const category = typeParam ? categoryBySlug(typeParam) : undefined;
  const mediaTypes = category?.mediaTypes;

  const [result, facets] = await Promise.all([
    searchTitles(backend.supabase, toSearchArgs(browse, mediaTypes)),
    getFacets(backend.supabase, mediaTypes),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const typeQuery = category ? `&type=${category.slug}` : '';
  const hrefFor = (page: number) => {
    const query = toQueryString(browse, { page });
    return `/search${query}${typeQuery ? (query ? typeQuery : `?${typeQuery.slice(1)}`) : ''}`;
  };
  if (browse.page > totalPages) redirect(hrefFor(totalPages));

  const typeHref = (slug?: string) => {
    const query = toQueryString(browse, { page: 1 });
    const extra = slug ? `type=${slug}` : '';
    return `/search${query}${extra ? (query ? `&${extra}` : `?${extra}`) : ''}`;
  };

  const first = result.offset + 1;
  const last = result.offset + result.items.length;
  const nothingHere = facets.total === 0;

  return (
    <div className="shell py-10">
      <h1 className="display text-5xl md:text-6xl">{browse.q ? `Results for “${browse.q}”` : 'Browse everything'}</h1>

      <div className="mt-6 max-w-2xl">
        <SearchBox initialQuery={browse.q ?? ''} />
      </div>

      <nav aria-label="Narrow by category" className="mt-5 flex flex-wrap gap-2">
        <Link href={typeHref()} className="chip" aria-current={category ? undefined : 'true'}>
          All
        </Link>
        {CATEGORIES.map((c) => (
          <Link key={c.slug} href={typeHref(c.slug)} className="chip" aria-current={category?.slug === c.slug ? 'true' : undefined}>
            {c.label}
          </Link>
        ))}
      </nav>

      {/* Nothing to filter or count when there are no titles at all (in the chosen category, or anywhere without one). */}
      {nothingHere ? null : (
        <>
          <div className="mt-6">
            <FilterForm
              action="/search"
              params={browse}
              facets={facets}
              withQuery={false}
              hidden={{ q: browse.q, type: category?.slug }}
              open={hasActiveFilters(browse)}
            />
          </div>

          <p className="tnum mt-6 text-sm text-muted" aria-live="polite">
            {result.total === 0
              ? 'No titles match.'
              : `Showing ${first.toLocaleString('en-US')} to ${last.toLocaleString('en-US')} of ${result.total.toLocaleString('en-US')} titles`}
          </p>
        </>
      )}

      <div className={nothingHere ? 'mt-6' : 'mt-4'}>
        {result.items.length > 0 ? (
          <TitleGrid titles={result.items} label="Search results" />
        ) : nothingHere && category ? (
          <EmptyState title={`No ${inSentence(category.label)} in the catalog yet`}>
            <p>Titles are imported from outside providers, and none have been imported for this category.</p>
          </EmptyState>
        ) : nothingHere ? (
          <EmptyState title="The catalog is empty">
            <p>There is nothing to search yet. Titles are imported from outside providers.</p>
          </EmptyState>
        ) : (
          <EmptyState title={browse.q ? `Nothing found for “${browse.q}”` : 'Nothing matches those filters'}>
            <p>Check the spelling, try fewer words, or remove a filter. Typos of a letter or two are forgiven.</p>
          </EmptyState>
        )}
      </div>

      <Pagination page={browse.page} totalPages={totalPages} hrefFor={hrefFor} />
    </div>
  );
}
