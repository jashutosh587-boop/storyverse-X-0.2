import { TITLE_STATUSES, type MediaType } from './providers/types';

export const SORTS = ['relevance', 'popularity', 'score', 'newest', 'oldest', 'title'] as const;
export type Sort = (typeof SORTS)[number];

export const SORT_LABEL: Record<Sort, string> = {
  relevance: 'Best match',
  popularity: 'Most popular',
  score: 'Highest rated',
  newest: 'Newest first',
  oldest: 'Oldest first',
  title: 'Title, A to Z',
};

export const PAGE_SIZE = 24;
export const MAX_PAGE = 500;

export interface BrowseParams {
  q: string | undefined;
  genres: string[];
  statuses: string[];
  yearFrom: number | undefined;
  yearTo: number | undefined;
  minScore: number | undefined;
  sort: Sort;
  page: number;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

const many = (value: string | string[] | undefined): string[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];
const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

function wholeNumber(value: string | undefined, min: number, max: number): number | undefined {
  if (value === undefined || !/^\d{1,6}$/.test(value.trim())) return undefined;
  const n = Number(value);
  return n >= min && n <= max ? n : undefined;
}

/**
 * Read filter, sort and page settings from a URL. Anything unusable is dropped
 * or clamped rather than rejected: a hand-edited link still shows a page.
 */
export function parseBrowseParams(raw: RawSearchParams): BrowseParams {
  const q = first(raw.q)?.trim().slice(0, 200) || undefined;

  const genres = [...new Set(many(raw.genre).map((g) => g.trim()).filter((g) => g !== '' && g.length <= 60))].slice(0, 12);
  const statuses = [...new Set(many(raw.status).filter((s) => (TITLE_STATUSES as readonly string[]).includes(s)))];

  let yearFrom = wholeNumber(first(raw.from), 1000, 3000);
  let yearTo = wholeNumber(first(raw.to), 1000, 3000);
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];

  const minText = first(raw.min)?.trim();
  const minNumber = minText !== undefined && /^\d{1,2}(\.\d)?$/.test(minText) ? Number(minText) : undefined;
  const minScore = minNumber !== undefined && minNumber > 0 && minNumber <= 10 ? minNumber : undefined;

  const requested = first(raw.sort);
  let sort: Sort = (SORTS as readonly string[]).includes(requested ?? '') ? (requested as Sort) : q ? 'relevance' : 'popularity';
  if (sort === 'relevance' && !q) sort = 'popularity';

  const page = wholeNumber(first(raw.page), 1, MAX_PAGE) ?? 1;
  return { q, genres, statuses, yearFrom, yearTo, minScore, sort, page };
}

/** The defaults a URL leaves out. */
const defaultSort = (q: string | undefined): Sort => (q ? 'relevance' : 'popularity');

/** Build a query string for these settings, with `patch` applied. Defaults are left out. */
export function toQueryString(params: BrowseParams, patch: Partial<BrowseParams> = {}): string {
  const p: BrowseParams = { ...params, ...patch };
  const query = new URLSearchParams();
  if (p.q) query.set('q', p.q);
  for (const genre of p.genres) query.append('genre', genre);
  for (const status of p.statuses) query.append('status', status);
  if (p.yearFrom !== undefined) query.set('from', String(p.yearFrom));
  if (p.yearTo !== undefined) query.set('to', String(p.yearTo));
  if (p.minScore !== undefined) query.set('min', String(p.minScore));
  if (p.sort !== defaultSort(p.q)) query.set('sort', p.sort);
  if (p.page > 1) query.set('page', String(p.page));
  const text = query.toString();
  return text ? `?${text}` : '';
}

export interface SearchArgs {
  q?: string;
  mediaTypes?: MediaType[];
  genres?: string[];
  statuses?: string[];
  yearFrom?: number;
  yearTo?: number;
  minScore?: number;
  sort: Sort;
  limit?: number;
  offset?: number;
}

/** Settings from the URL as the arguments `search_titles` expects. */
export function toSearchArgs(params: BrowseParams, mediaTypes?: MediaType[]): SearchArgs {
  return {
    q: params.q,
    mediaTypes,
    genres: params.genres.length ? params.genres : undefined,
    statuses: params.statuses.length ? params.statuses : undefined,
    yearFrom: params.yearFrom,
    yearTo: params.yearTo,
    minScore: params.minScore,
    sort: params.sort,
    limit: PAGE_SIZE,
    offset: (params.page - 1) * PAGE_SIZE,
  };
}

export function hasActiveFilters(params: BrowseParams): boolean {
  return (
    params.genres.length > 0 ||
    params.statuses.length > 0 ||
    params.yearFrom !== undefined ||
    params.yearTo !== undefined ||
    params.minScore !== undefined
  );
}
