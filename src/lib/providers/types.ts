import { z } from 'zod';

export const MEDIA_TYPES = ['anime', 'movie', 'tv', 'book', 'novel', 'manga', 'comic'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const TITLE_STATUSES = [
  'announced',
  'upcoming',
  'releasing',
  'finished',
  'hiatus',
  'cancelled',
  'unknown',
] as const;
export type TitleStatus = (typeof TITLE_STATUSES)[number];

export const PROVIDER_IDS = ['jikan', 'tmdb', 'openlibrary'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const RELATION_TYPES = [
  'sequel',
  'prequel',
  'adapted_from',
  'adapted_into',
  'spin_off',
  'side_story',
  'parent_story',
  'summary',
  'full_story',
  'alternative_version',
  'alternative_setting',
  'alternative_adaptation',
  'same_franchise',
  'same_universe',
  'similar_story',
  'shares_themes',
  'inspired_by',
  'inspired',
  'character',
  'other',
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'not a real calendar date');

const nonNegInt = z.number().int().nonnegative();

export const contributorSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  externalId: z.string().min(1),
  kind: z.enum(['person', 'studio', 'publisher', 'company']),
  name: z.string().trim().min(1).max(300),
  role: z.string().trim().min(1).max(80),
  order: z.number().int().optional(),
});

/**
 * The provider-neutral record every adapter produces and the pipeline stores.
 * Anything a provider does not supply stays undefined: the pipeline never
 * fills a gap with a guess.
 */
export const normalizedTitleSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  externalId: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  attribution: z.string().min(1),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),

  mediaType: z.enum(MEDIA_TYPES),
  format: z.string().trim().min(1).max(60).optional(),
  title: z.string().trim().min(1).max(500),
  titleOriginal: z.string().trim().min(1).max(500).optional(),
  altNames: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(500),
        lang: z.string().max(16).optional(),
        kind: z.enum(['synonym', 'translated', 'romanized', 'native']).default('synonym'),
      }),
    )
    .default([]),
  synopsis: z.string().trim().min(1).max(20000).optional(),
  status: z.enum(TITLE_STATUSES),

  releaseDate: isoDate.optional(),
  endDate: isoDate.optional(),
  releaseYear: z.number().int().min(1).max(3000).optional(),
  season: z.enum(['winter', 'spring', 'summer', 'fall']).optional(),
  seasonYear: z.number().int().min(1).max(3000).optional(),

  country: z.string().length(2).optional(),
  language: z.string().min(2).max(8).optional(),
  episodes: nonNegInt.optional(),
  runtimeMinutes: nonNegInt.optional(),
  pages: nonNegInt.optional(),
  volumes: nonNegInt.optional(),
  chapters: nonNegInt.optional(),
  ageRating: z.string().trim().min(1).max(120).optional(),

  genres: z.array(z.string().min(1)).default([]),
  themes: z.array(z.string().min(1)).default([]),
  posterUrl: z.string().url().optional(),
  backdropUrl: z.string().url().optional(),

  providerScore: z.number().min(0).max(10).optional(),
  providerScoreCount: nonNegInt.optional(),
  providerScoreSource: z.string().max(120).optional(),
  popularity: z.number().nonnegative().optional(),

  contributors: z.array(contributorSchema).default([]),
});
export type NormalizedTitle = z.infer<typeof normalizedTitleSchema>;
export type NormalizedContributor = z.infer<typeof contributorSchema>;

export interface NormalizedRelation {
  relation: RelationType;
  target: {
    provider: ProviderId;
    externalId: string;
    mediaType: MediaType;
    title: string;
  };
}

/** One record the provider returned that could not be normalized. */
export interface ProviderItemError {
  externalId?: string;
  message: string;
}

export interface ListPage {
  page: number;
  items: NormalizedTitle[];
  errors: ProviderItemError[];
  hasNext: boolean;
}

export interface ListOptions {
  /** How to order results where the provider supports it. */
  order?: 'popular' | 'score' | 'newest';
  /** Free-text query. */
  query?: string;
  /** A subject/topic (Open Library). */
  subject?: string;
  limit?: number;
}

export type ProviderConfigStatus = { ok: true } | { ok: false; missing: string[] };

export interface ProviderAdapter {
  readonly id: ProviderId;
  /** What this adapter can list: 'anime', 'manga', 'movie', 'tv', 'books'... */
  readonly kinds: readonly string[];
  isConfigured(): ProviderConfigStatus;
  listPage(kind: string, page: number, options?: ListOptions): Promise<ListPage>;
  /** Edges to other titles, when the provider exposes them. */
  fetchRelations?(kind: string, externalId: string): Promise<NormalizedRelation[]>;
}
