import { z } from 'zod';
import type { HttpClient } from './http';
import {
  normalizedTitleSchema,
  type ListOptions,
  type ListPage,
  type MediaType,
  type NormalizedContributor,
  type NormalizedRelation,
  type NormalizedTitle,
  type ProviderAdapter,
  type ProviderItemError,
  type RelationType,
  type TitleStatus,
} from './types';
import {
  dedupeNames,
  flipName,
  hashPayload,
  normalizeGenres,
  parseDurationMinutes,
  toIsoDate,
  yearOf,
} from './util';

/**
 * Jikan is an unofficial REST API over MyAnimeList data (https://jikan.moe).
 * Fields below follow the documented v4 response shape. Validation is lenient
 * on purpose: only fields we cannot work without are required, everything else
 * is optional so a provider change degrades one field instead of a whole page.
 */
export const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';
const ATTRIBUTION = 'Metadata and scores from MyAnimeList, retrieved through the Jikan API.';
const SCORE_SOURCE = 'MyAnimeList';

/**
 * MyAnimeList numbers anime and manga separately: anime 1 and manga 1 are
 * different works. The external id therefore carries the namespace, otherwise
 * one would overwrite the other in the catalog.
 */
export function jikanId(kind: 'anime' | 'manga', malId: number | string): string {
  return `${kind}:${malId}`;
}

/** The numeric MyAnimeList id inside an external id; also accepts a bare number. */
function malIdOf(kind: 'anime' | 'manga', externalId: string): string {
  const id = externalId.startsWith(`${kind}:`) ? externalId.slice(kind.length + 1) : externalId;
  if (!/^\d{1,9}$/.test(id)) throw new Error(`Invalid Jikan ${kind} id "${externalId}"`);
  return id;
}

const image = z
  .object({
    image_url: z.string().nullish(),
    large_image_url: z.string().nullish(),
  })
  .partial()
  .nullish();

const entity = z.object({ mal_id: z.number().int(), name: z.string() }).passthrough();
const dateRange = z.object({ from: z.string().nullish(), to: z.string().nullish() }).partial().nullish();

const jikanItemSchema = z
  .object({
    mal_id: z.number().int(),
    url: z.string().nullish(),
    images: z.object({ jpg: image, webp: image }).partial().nullish(),
    titles: z.array(z.object({ type: z.string(), title: z.string() })).nullish(),
    title: z.string().min(1),
    title_english: z.string().nullish(),
    title_japanese: z.string().nullish(),
    title_synonyms: z.array(z.string()).nullish(),
    type: z.string().nullish(),
    status: z.string().nullish(),
    episodes: z.number().int().nullish(),
    chapters: z.number().int().nullish(),
    volumes: z.number().int().nullish(),
    aired: dateRange,
    published: dateRange,
    duration: z.string().nullish(),
    rating: z.string().nullish(),
    score: z.number().nullish(),
    scored_by: z.number().nullish(),
    members: z.number().nullish(),
    synopsis: z.string().nullish(),
    season: z.string().nullish(),
    year: z.number().int().nullish(),
    studios: z.array(entity).nullish(),
    producers: z.array(entity).nullish(),
    authors: z.array(entity).nullish(),
    genres: z.array(entity).nullish(),
    themes: z.array(entity).nullish(),
    demographics: z.array(entity).nullish(),
  })
  .passthrough();
type JikanItem = z.infer<typeof jikanItemSchema>;

const listSchema = z.object({
  pagination: z
    .object({ has_next_page: z.boolean().nullish(), current_page: z.number().int().nullish() })
    .partial()
    .nullish(),
  data: z.array(z.unknown()),
});

const relationsSchema = z.object({
  data: z.array(
    z.object({
      relation: z.string(),
      entry: z.array(z.object({ mal_id: z.number().int(), type: z.string(), name: z.string() })),
    }),
  ),
});

// ---------------------------------------------------------------------------
// field mapping
// ---------------------------------------------------------------------------
const ANIME_STATUS: Record<string, TitleStatus> = {
  'finished airing': 'finished',
  'currently airing': 'releasing',
  'not yet aired': 'upcoming',
};
const MANGA_STATUS: Record<string, TitleStatus> = {
  finished: 'finished',
  publishing: 'releasing',
  'on hiatus': 'hiatus',
  discontinued: 'cancelled',
  'not yet published': 'upcoming',
};

const LANG_BY_TITLE_TYPE: Record<string, string> = {
  English: 'en',
  Japanese: 'ja',
  German: 'de',
  Spanish: 'es',
  French: 'fr',
  Korean: 'ko',
  Chinese: 'zh',
};

const PLACEHOLDER_IMAGE = /apple-touch-icon|\/img\/sp\//;

function pickImage(item: JikanItem): string | undefined {
  const url =
    item.images?.webp?.large_image_url ??
    item.images?.jpg?.large_image_url ??
    item.images?.webp?.image_url ??
    item.images?.jpg?.image_url ??
    undefined;
  return url && !PLACEHOLDER_IMAGE.test(url) ? url : undefined;
}

function altNames(item: JikanItem): NormalizedTitle['altNames'] {
  const names: NormalizedTitle['altNames'] = [];
  for (const t of item.titles ?? []) {
    if (t.type === 'Default') continue;
    const lang = LANG_BY_TITLE_TYPE[t.type];
    names.push({
      name: t.title,
      lang,
      kind: t.type === 'Japanese' ? 'native' : t.type === 'Synonym' ? 'synonym' : 'translated',
    });
  }
  // Older payloads only carry the flat fields.
  if (!item.titles?.length) {
    if (item.title_english) names.push({ name: item.title_english, lang: 'en', kind: 'translated' });
    if (item.title_japanese) names.push({ name: item.title_japanese, lang: 'ja', kind: 'native' });
    for (const s of item.title_synonyms ?? []) names.push({ name: s, kind: 'synonym' });
  }
  return dedupeNames(names, [item.title]);
}

function contributors(
  entities: ReadonlyArray<{ mal_id: number; name: string }> | null | undefined,
  kind: NormalizedContributor['kind'],
  role: string,
  limit: number,
  rename: (n: string) => string = (n) => n,
): NormalizedContributor[] {
  // Studios and producers are the same kind of record on MyAnimeList (one id
  // space), so the id is keyed by what the entity is, not by the credit it got.
  const space = kind === 'person' ? 'person' : 'company';
  return (entities ?? []).slice(0, limit).map((e, i) => ({
    provider: 'jikan' as const,
    externalId: `${space}:${e.mal_id}`,
    kind,
    name: rename(e.name),
    role,
    order: i,
  }));
}

function tags(item: JikanItem) {
  return {
    genres: normalizeGenres((item.genres ?? []).map((g) => g.name)),
    themes: normalizeGenres([...(item.themes ?? []), ...(item.demographics ?? [])].map((g) => g.name)),
  };
}

function score(item: JikanItem) {
  return item.score && item.score > 0
    ? {
        providerScore: item.score,
        providerScoreCount: item.scored_by ?? undefined,
        providerScoreSource: SCORE_SOURCE,
      }
    : {};
}

export function normalizeJikanAnime(raw: unknown): NormalizedTitle {
  const item = jikanItemSchema.parse(raw);
  const releaseDate = toIsoDate(item.aired?.from);
  const season = ['winter', 'spring', 'summer', 'fall'].includes(item.season ?? '')
    ? (item.season as 'winter' | 'spring' | 'summer' | 'fall')
    : undefined;

  return normalizedTitleSchema.parse({
    provider: 'jikan',
    externalId: jikanId('anime', item.mal_id),
    sourceUrl: item.url ?? `https://myanimelist.net/anime/${item.mal_id}`,
    attribution: ATTRIBUTION,
    payloadHash: hashPayload(raw),
    mediaType: 'anime',
    format: item.type ?? undefined,
    title: item.title,
    titleOriginal: item.title_japanese ?? undefined,
    altNames: altNames(item),
    synopsis: item.synopsis ?? undefined,
    status: ANIME_STATUS[(item.status ?? '').toLowerCase()] ?? 'unknown',
    releaseDate,
    endDate: toIsoDate(item.aired?.to),
    releaseYear: yearOf(releaseDate) ?? item.year ?? undefined,
    season,
    seasonYear: season ? (item.year ?? undefined) : undefined,
    country: 'JP',
    language: 'ja',
    episodes: item.episodes ?? undefined,
    runtimeMinutes: parseDurationMinutes(item.duration),
    ageRating: item.rating ?? undefined,
    ...tags(item),
    posterUrl: pickImage(item),
    ...score(item),
    popularity: item.members ?? undefined,
    contributors: [
      ...contributors(item.studios, 'studio', 'Studio', 5),
      ...contributors(item.producers, 'company', 'Producer', 6),
    ],
  });
}

export function normalizeJikanManga(raw: unknown): NormalizedTitle {
  const item = jikanItemSchema.parse(raw);
  const releaseDate = toIsoDate(item.published?.from);
  const type = item.type ?? undefined;
  const mediaType: MediaType = type === 'Novel' || type === 'Light Novel' ? 'novel' : 'manga';
  const country = type === 'Manhwa' ? 'KR' : type === 'Manhua' ? 'CN' : 'JP';
  const language = country === 'KR' ? 'ko' : country === 'CN' ? 'zh' : 'ja';

  return normalizedTitleSchema.parse({
    provider: 'jikan',
    // Novels and light novels live in the manga id space on MyAnimeList too.
    externalId: jikanId('manga', item.mal_id),
    sourceUrl: item.url ?? `https://myanimelist.net/manga/${item.mal_id}`,
    attribution: ATTRIBUTION,
    payloadHash: hashPayload(raw),
    mediaType,
    format: type,
    title: item.title,
    titleOriginal: item.title_japanese ?? undefined,
    altNames: altNames(item),
    synopsis: item.synopsis ?? undefined,
    status: MANGA_STATUS[(item.status ?? '').toLowerCase()] ?? 'unknown',
    releaseDate,
    endDate: toIsoDate(item.published?.to),
    releaseYear: yearOf(releaseDate),
    country,
    language,
    chapters: item.chapters ?? undefined,
    volumes: item.volumes ?? undefined,
    ...tags(item),
    posterUrl: pickImage(item),
    ...score(item),
    popularity: item.members ?? undefined,
    contributors: contributors(item.authors, 'person', 'Author', 6, flipName),
  });
}

// ---------------------------------------------------------------------------
// relations
// ---------------------------------------------------------------------------
const RELATION_BY_LABEL: Record<string, RelationType> = {
  sequel: 'sequel',
  prequel: 'prequel',
  'alternative version': 'alternative_version',
  'alternative setting': 'alternative_setting',
  'side story': 'side_story',
  'parent story': 'parent_story',
  'spin-off': 'spin_off',
  summary: 'summary',
  'full story': 'full_story',
  character: 'character',
  other: 'other',
};

export function normalizeJikanRelations(fromKind: 'anime' | 'manga', raw: unknown): NormalizedRelation[] {
  const parsed = relationsSchema.parse(raw);
  const out: NormalizedRelation[] = [];
  for (const group of parsed.data) {
    const label = group.relation.trim().toLowerCase();
    for (const entry of group.entry) {
      if (entry.type !== 'anime' && entry.type !== 'manga') continue;
      // MyAnimeList uses the label "Adaptation" in both directions; the media
      // types tell us which way it points.
      const relation: RelationType =
        label === 'adaptation'
          ? fromKind === 'anime'
            ? 'adapted_from'
            : 'adapted_into'
          : (RELATION_BY_LABEL[label] ?? 'other');
      out.push({
        relation,
        target: {
          provider: 'jikan',
          externalId: jikanId(entry.type, entry.mal_id),
          // The entry's own namespace is anime or manga; a related light novel is
          // listed as "manga" here and only becomes a novel once it is ingested.
          mediaType: entry.type,
          title: entry.name,
        },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// adapter
// ---------------------------------------------------------------------------
const ORDER: Record<NonNullable<ListOptions['order']>, string> = {
  popular: 'order_by=members&sort=desc',
  score: 'order_by=score&sort=desc',
  newest: 'order_by=start_date&sort=desc',
};

export function createJikanAdapter(http: HttpClient, baseUrl: string = JIKAN_BASE_URL): ProviderAdapter {
  return {
    id: 'jikan',
    kinds: ['anime', 'manga'],
    isConfigured: () => ({ ok: true }),

    async listPage(kind, page, options = {}): Promise<ListPage> {
      if (kind !== 'anime' && kind !== 'manga') throw new Error(`Jikan cannot list "${kind}"`);
      const limit = Math.min(options.limit ?? 25, 25);
      const params = [
        `page=${page}`,
        `limit=${limit}`,
        'sfw=true',
        ORDER[options.order ?? 'popular'],
        ...(options.query ? [`q=${encodeURIComponent(options.query)}`] : []),
      ];
      const body = listSchema.parse(await http.getJson(`${baseUrl}/${kind}?${params.join('&')}`));

      const normalize = kind === 'anime' ? normalizeJikanAnime : normalizeJikanManga;
      const items: NormalizedTitle[] = [];
      const errors: ProviderItemError[] = [];
      for (const raw of body.data) {
        try {
          items.push(normalize(raw));
        } catch (err) {
          const id = (raw as { mal_id?: unknown } | null)?.mal_id;
          errors.push({
            externalId: typeof id === 'number' ? jikanId(kind, id) : undefined,
            message: err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(err),
          });
        }
      }
      return { page, items, errors, hasNext: body.pagination?.has_next_page === true };
    },

    async fetchRelations(kind, externalId): Promise<NormalizedRelation[]> {
      if (kind !== 'anime' && kind !== 'manga') throw new Error(`Jikan has no relations for "${kind}"`);
      const malId = malIdOf(kind, externalId); // also keeps odd ids out of the request path
      return normalizeJikanRelations(kind, await http.getJson(`${baseUrl}/${kind}/${malId}/relations`));
    },
  };
}
