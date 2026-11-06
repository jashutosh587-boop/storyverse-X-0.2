import { z } from 'zod';
import type { HttpClient } from './http';
import {
  normalizedTitleSchema,
  type ListOptions,
  type ListPage,
  type NormalizedContributor,
  type NormalizedTitle,
  type ProviderAdapter,
  type ProviderItemError,
  type TitleStatus,
} from './types';
import { hashPayload, normalizeGenres, toIsoDate, yearOf } from './util';

/**
 * TMDB (https://www.themoviedb.org). Requires a read access token.
 *
 * LICENSING: TMDB's API is free for NON-COMMERCIAL use with attribution. A
 * product whose main purpose is revenue needs a commercial licence from TMDB.
 * Do not enable ads or paid plans on a site that shows TMDB data without one.
 * See docs/DATA-SOURCES.md.
 */
export const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';
const SCORE_SOURCE = 'TMDB';

const credits = z
  .object({
    cast: z
      .array(z.object({ id: z.number().int(), name: z.string(), order: z.number().nullish() }))
      .nullish(),
    crew: z
      .array(z.object({ id: z.number().int(), name: z.string(), job: z.string().nullish() }))
      .nullish(),
  })
  .nullish();

const common = {
  id: z.number().int(),
  overview: z.string().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  vote_average: z.number().nullish(),
  vote_count: z.number().nullish(),
  popularity: z.number().nullish(),
  original_language: z.string().nullish(),
  status: z.string().nullish(),
  genres: z.array(z.object({ id: z.number().int(), name: z.string() })).nullish(),
  credits,
};

const movieSchema = z
  .object({
    ...common,
    title: z.string().min(1),
    original_title: z.string().nullish(),
    release_date: z.string().nullish(),
    runtime: z.number().nullish(),
    production_countries: z.array(z.object({ iso_3166_1: z.string() })).nullish(),
  })
  .passthrough();

const tvSchema = z
  .object({
    ...common,
    name: z.string().min(1),
    original_name: z.string().nullish(),
    first_air_date: z.string().nullish(),
    last_air_date: z.string().nullish(),
    number_of_episodes: z.number().int().nullish(),
    episode_run_time: z.array(z.number()).nullish(),
    origin_country: z.array(z.string()).nullish(),
    in_production: z.boolean().nullish(),
    created_by: z.array(z.object({ id: z.number().int(), name: z.string() })).nullish(),
  })
  .passthrough();

const discoverSchema = z.object({
  page: z.number().int(),
  total_pages: z.number().int(),
  results: z.array(z.object({ id: z.number().int() }).passthrough()),
});

const MOVIE_STATUS: Record<string, TitleStatus> = {
  released: 'finished',
  'post production': 'upcoming',
  'in production': 'upcoming',
  planned: 'announced',
  rumored: 'announced',
  canceled: 'cancelled',
};
const TV_STATUS: Record<string, TitleStatus> = {
  'returning series': 'releasing',
  ended: 'finished',
  canceled: 'cancelled',
  'in production': 'upcoming',
  planned: 'announced',
  pilot: 'upcoming',
};

function people(raw: z.infer<typeof credits>, creators: ReadonlyArray<{ id: number; name: string }> = []) {
  const out: NormalizedContributor[] = [];
  creators.forEach((c, i) =>
    out.push({ provider: 'tmdb', externalId: `creator:${c.id}`, kind: 'person', name: c.name, role: 'Creator', order: i }),
  );
  (raw?.crew ?? [])
    .filter((c) => c.job === 'Director')
    .slice(0, 4)
    .forEach((c, i) =>
      out.push({ provider: 'tmdb', externalId: `director:${c.id}`, kind: 'person', name: c.name, role: 'Director', order: i }),
    );
  [...(raw?.cast ?? [])]
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, 8)
    .forEach((c, i) =>
      out.push({ provider: 'tmdb', externalId: `cast:${c.id}`, kind: 'person', name: c.name, role: 'Cast', order: 10 + i }),
    );
  return out;
}

function scoring(voteAverage: number | null | undefined, voteCount: number | null | undefined) {
  // 0.0 with no votes means "unrated", not "terrible".
  return voteCount && voteCount > 0 && voteAverage != null
    ? { providerScore: voteAverage, providerScoreCount: voteCount, providerScoreSource: SCORE_SOURCE }
    : {};
}

export function normalizeTmdbMovie(raw: unknown): NormalizedTitle {
  const m = movieSchema.parse(raw);
  const releaseDate = toIsoDate(m.release_date);
  return normalizedTitleSchema.parse({
    provider: 'tmdb',
    externalId: `movie:${m.id}`,
    sourceUrl: `https://www.themoviedb.org/movie/${m.id}`,
    attribution: ATTRIBUTION,
    payloadHash: hashPayload(raw),
    mediaType: 'movie',
    format: 'Movie',
    title: m.title,
    titleOriginal: m.original_title && m.original_title !== m.title ? m.original_title : undefined,
    synopsis: m.overview || undefined,
    status: MOVIE_STATUS[(m.status ?? '').toLowerCase()] ?? 'unknown',
    releaseDate,
    releaseYear: yearOf(releaseDate),
    country: m.production_countries?.[0]?.iso_3166_1,
    language: m.original_language || undefined,
    runtimeMinutes: m.runtime && m.runtime > 0 ? m.runtime : undefined,
    genres: normalizeGenres((m.genres ?? []).map((g) => g.name)),
    posterUrl: m.poster_path ? `${TMDB_IMAGE_BASE}/w500${m.poster_path}` : undefined,
    backdropUrl: m.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${m.backdrop_path}` : undefined,
    ...scoring(m.vote_average, m.vote_count),
    popularity: m.popularity ?? undefined,
    contributors: people(m.credits),
  });
}

export function normalizeTmdbTv(raw: unknown): NormalizedTitle {
  const t = tvSchema.parse(raw);
  const releaseDate = toIsoDate(t.first_air_date);
  const ended = t.status ? (TV_STATUS[t.status.toLowerCase()] ?? 'unknown') === 'finished' : false;
  return normalizedTitleSchema.parse({
    provider: 'tmdb',
    externalId: `tv:${t.id}`,
    sourceUrl: `https://www.themoviedb.org/tv/${t.id}`,
    attribution: ATTRIBUTION,
    payloadHash: hashPayload(raw),
    mediaType: 'tv',
    format: 'TV',
    title: t.name,
    titleOriginal: t.original_name && t.original_name !== t.name ? t.original_name : undefined,
    synopsis: t.overview || undefined,
    status: TV_STATUS[(t.status ?? '').toLowerCase()] ?? 'unknown',
    releaseDate,
    endDate: ended ? toIsoDate(t.last_air_date) : undefined,
    releaseYear: yearOf(releaseDate),
    country: t.origin_country?.[0],
    language: t.original_language || undefined,
    episodes: t.number_of_episodes ?? undefined,
    runtimeMinutes: t.episode_run_time?.[0] && t.episode_run_time[0] > 0 ? t.episode_run_time[0] : undefined,
    genres: normalizeGenres((t.genres ?? []).map((g) => g.name)),
    posterUrl: t.poster_path ? `${TMDB_IMAGE_BASE}/w500${t.poster_path}` : undefined,
    backdropUrl: t.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${t.backdrop_path}` : undefined,
    ...scoring(t.vote_average, t.vote_count),
    popularity: t.popularity ?? undefined,
    contributors: people(t.credits, t.created_by ?? []),
  });
}

const SORT: Record<NonNullable<ListOptions['order']>, string> = {
  popular: 'popularity.desc',
  score: 'vote_average.desc&vote_count.gte=500',
  newest: 'primary_release_date.desc&vote_count.gte=10',
};

export function createTmdbAdapter(http: HttpClient, token: string | undefined, baseUrl: string = TMDB_BASE_URL): ProviderAdapter {
  return {
    id: 'tmdb',
    kinds: ['movie', 'tv'],
    isConfigured: () => (token ? { ok: true } : { ok: false, missing: ['TMDB_READ_ACCESS_TOKEN'] }),

    async listPage(kind, page, options = {}): Promise<ListPage> {
      if (kind !== 'movie' && kind !== 'tv') throw new Error(`TMDB cannot list "${kind}"`);
      // TMDB stops serving results after page 500.
      if (page > 500) return { page, items: [], errors: [], hasNext: false };

      const sort = SORT[options.order ?? 'popular'].replace('primary_release_date', kind === 'tv' ? 'first_air_date' : 'primary_release_date');
      const list = discoverSchema.parse(
        await http.getJson(`${baseUrl}/discover/${kind}?include_adult=false&language=en-US&sort_by=${sort}&page=${page}`),
      );

      const items: NormalizedTitle[] = [];
      const errors: ProviderItemError[] = [];
      for (const { id } of list.results) {
        try {
          const detail = await http.getJson(`${baseUrl}/${kind}/${id}?language=en-US&append_to_response=credits`);
          items.push(kind === 'movie' ? normalizeTmdbMovie(detail) : normalizeTmdbTv(detail));
        } catch (err) {
          errors.push({
            externalId: `${kind}:${id}`,
            message: err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(err),
          });
        }
      }
      return { page, items, errors, hasNext: list.page < list.total_pages && page < 500 };
    },
  };
}
