import { z } from 'zod';
import { MEDIA_TYPES } from '../providers/types';

/**
 * The shape of what each database function returns. The app parses every answer
 * with these, so a mismatch between the code and the database shows up as a clear
 * error instead of a page that renders undefined.
 */
const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

export const titleCardSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  media_type: z.enum(MEDIA_TYPES),
  format: nullableString,
  poster_url: nullableString,
  release_year: nullableNumber,
  status: z.string(),
  provider_score: nullableNumber,
  provider_score_count: nullableNumber,
  provider_score_source: nullableString,
  genres: z.array(z.string()),
  episodes: nullableNumber,
  chapters: nullableNumber,
  volumes: nullableNumber,
  pages: nullableNumber,
  runtime_minutes: nullableNumber,
  is_stub: z.boolean(),
});
export type TitleCard = z.infer<typeof titleCardSchema>;

export const searchResultSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  items: z.array(titleCardSchema),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const titleDetailSchema = z
  .object({
    title: titleCardSchema.extend({
      title_original: nullableString,
      synopsis: nullableString,
      release_date: nullableString,
      end_date: nullableString,
      season: nullableString,
      season_year: nullableNumber,
      country: nullableString,
      language: nullableString,
      age_rating: nullableString,
      themes: z.array(z.string()),
      backdrop_url: nullableString,
      progress_unit: nullableString,
      progress_total: nullableNumber,
    }),
    alt_names: z.array(z.object({ name: z.string(), lang: nullableString, kind: z.string() })),
    contributors: z.array(
      z.object({ id: z.string(), slug: z.string(), name: z.string(), kind: z.string(), role: z.string() }),
    ),
    sources: z.array(
      z.object({
        provider: z.string(),
        external_id: z.string(),
        url: nullableString,
        attribution: nullableString,
        fetched_at: z.string(),
      }),
    ),
    relations: z.array(z.object({ relation: z.string(), title: titleCardSchema })),
    community: z.object({
      count: z.number(),
      average: nullableNumber,
      bayesian: nullableNumber,
      distribution: z.record(z.string(), z.number()),
    }),
  })
  .nullable();
export type TitleDetail = NonNullable<z.infer<typeof titleDetailSchema>>;

export const similarTitlesSchema = z.array(
  titleCardSchema.extend({ similarity: z.number(), shared_tags: z.array(z.string()) }),
);

export const facetsSchema = z.object({
  total: z.number(),
  genres: z.array(z.object({ name: z.string(), count: z.number() })),
  years: z.object({ min: nullableNumber, max: nullableNumber }),
  statuses: z.array(z.object({ name: z.string(), count: z.number() })),
});
export type Facets = z.infer<typeof facetsSchema>;

export const suggestionsSchema = z.array(
  z.object({
    slug: z.string(),
    title: z.string(),
    media_type: z.enum(MEDIA_TYPES),
    release_year: nullableNumber,
    poster_url: nullableString,
  }),
);
export type Suggestion = z.infer<typeof suggestionsSchema>[number];

export const catalogStatsSchema = z.object({
  total: z.number(),
  by_type: z.record(z.string(), z.number()),
});

export const attributionsSchema = z.array(
  z.object({
    provider: z.string(),
    titles: z.number(),
    attribution: nullableString,
    last_fetched_at: nullableString,
  }),
);

export const LIBRARY_STATUSES = ['planned', 'in_progress', 'completed', 'paused', 'dropped', 'repeating'] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

export const libraryEntrySchema = z.object({
  title_id: z.string().uuid(),
  status: z.enum(LIBRARY_STATUSES),
  progress: z.number(),
  rating: nullableNumber,
  // Absent for anyone but the owner: the database removes notes from other people's view.
  notes: nullableString.optional(),
  is_private: z.boolean(),
  started_at: nullableString,
  completed_at: nullableString,
  created_at: z.string(),
  updated_at: z.string(),
});
export type LibraryEntry = z.infer<typeof libraryEntrySchema>;

export const libraryListSchema = z.object({
  total: z.number(),
  counts: z.record(z.string(), z.number()),
  items: z.array(
    z.object({
      entry: libraryEntrySchema,
      title: titleCardSchema,
      progress_unit: nullableString,
      progress_total: nullableNumber,
    }),
  ),
});
export type LibraryList = z.infer<typeof libraryListSchema>;

export const profileSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  display_name: nullableString,
  bio: nullableString,
  avatar_url: nullableString,
  is_public: z.boolean(),
  is_self: z.boolean(),
  created_at: z.string(),
});
export type Profile = z.infer<typeof profileSchema>;


export const watchCatalogSchema = z.object({
  providers: z.array(z.object({
    id: z.string().uuid(),
    provider_name: z.string(),
    url: z.string().url(),
    country_code: z.string().length(2),
    availability: z.enum(['subscription', 'free', 'ads', 'rent', 'buy', 'unknown']),
    audio_languages: z.array(z.string()),
    subtitle_languages: z.array(z.string()),
    verified_at: nullableString,
  })),
  episodes: z.array(z.object({
    id: z.string().uuid(),
    season_number: z.number().int().positive(),
    episode_number: z.number().int().positive(),
    episode_title: z.string(),
    synopsis: nullableString,
    runtime_seconds: nullableNumber,
    stream_url: z.string().url(),
    stream_type: z.enum(['hls', 'mp4']),
    position_seconds: z.number().int().nonnegative(),
    duration_seconds: nullableNumber,
    completed: z.boolean(),
  })),
});
