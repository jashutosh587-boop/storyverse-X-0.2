import Link from 'next/link';
import type { Facets } from '@/lib/api/schemas';
import { SORT_LABEL, SORTS, type BrowseParams } from '@/lib/browse-params';
import { statusLabel } from '@/lib/format';

/**
 * Filters and sorting as a plain GET form: the URL is the state, so results can
 * be bookmarked and shared, and the form works without JavaScript.
 */
export function FilterForm({
  action,
  params,
  facets,
  withQuery,
  hidden = {},
  open,
}: {
  action: string;
  params: BrowseParams;
  facets: Facets | null;
  /** Show a "Title contains" box. Off where the page has its own search box. */
  withQuery: boolean;
  /** Values the form must send back unchanged, such as the search text of the page it sits on. */
  hidden?: Record<string, string | undefined>;
  open: boolean;
}) {
  const sorts = SORTS.filter((s) => s !== 'relevance' || params.q);
  // "Clear filters" drops the narrowing, but keeps what the page was asked to look for.
  const kept = new URLSearchParams(Object.entries(hidden).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const clearHref = kept.size > 0 ? `${action}?${kept.toString()}` : action;

  return (
    <details open={open} className="panel group">
      <summary className="cursor-pointer select-none font-medium">Filter and sort</summary>

      <form action={action} method="get" className="mt-5 space-y-6">
        {Object.entries(hidden).map(([name, value]) =>
          value ? <input key={name} type="hidden" name={name} value={value} /> : null,
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {withQuery ? (
            <div>
              <label htmlFor="f-q" className="label">
                Title contains
              </label>
              <input id="f-q" name="q" type="search" defaultValue={params.q} maxLength={200} className="field" />
            </div>
          ) : null}
          <div>
            <label htmlFor="f-sort" className="label">
              Sort by
            </label>
            <select id="f-sort" name="sort" defaultValue={params.sort} className="field">
              {sorts.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {facets && facets.genres.length > 0 ? (
          <fieldset>
            <legend className="label">Genres (titles with any of them)</legend>
            <div className="flex flex-wrap gap-2">
              {facets.genres.map((genre) => (
                <label key={genre.name} className="chip">
                  <input type="checkbox" name="genre" value={genre.name} defaultChecked={params.genres.includes(genre.name)} className="sr-only" />
                  {genre.name}
                  <span className="tnum text-muted">{genre.count}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {facets && facets.statuses.length > 0 ? (
          <fieldset>
            <legend className="label">Status</legend>
            <div className="flex flex-wrap gap-2">
              {facets.statuses.map((status) => (
                <label key={status.name} className="chip">
                  <input type="checkbox" name="status" value={status.name} defaultChecked={params.statuses.includes(status.name)} className="sr-only" />
                  {statusLabel(status.name)}
                  <span className="tnum text-muted">{status.count}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="f-from" className="label">
              From year
            </label>
            <input
              id="f-from"
              name="from"
              type="number"
              inputMode="numeric"
              min={1000}
              max={3000}
              defaultValue={params.yearFrom}
              placeholder="Any"
              className="field"
            />
            {facets?.years.min ? <p className="hint">Earliest is {facets.years.min}.</p> : null}
          </div>
          <div>
            <label htmlFor="f-to" className="label">
              To year
            </label>
            <input
              id="f-to"
              name="to"
              type="number"
              inputMode="numeric"
              min={1000}
              max={3000}
              defaultValue={params.yearTo}
              placeholder="Any"
              className="field"
            />
            {facets?.years.max ? <p className="hint">Latest is {facets.years.max}.</p> : null}
          </div>
          <div>
            <label htmlFor="f-min" className="label">
              Minimum score
            </label>
            <input id="f-min" name="min" type="number" inputMode="decimal" min={0} max={10} step={0.5} defaultValue={params.minScore} placeholder="Any" className="field" />
            <p className="hint">Out of 10, as scored by the data source.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn btn-primary">
            Show results
          </button>
          <Link href={clearHref} className="btn btn-quiet">
            Clear filters
          </Link>
        </div>
      </form>
    </details>
  );
}
