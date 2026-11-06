import { z } from 'zod';
import type { HttpClient } from './http';
import {
  normalizedTitleSchema,
  type ListPage,
  type NormalizedContributor,
  type NormalizedTitle,
  type ProviderAdapter,
  type ProviderItemError,
} from './types';
import { hashPayload, normalizeGenres, slugify, toDisplayCase } from './util';

/**
 * Open Library (https://openlibrary.org). No key needed, but it asks callers to
 * identify themselves with a User-Agent that includes a contact address
 * (3 requests/second when identified, 1 when not) and not to bulk download
 * through the API. For large imports use their monthly data dumps instead.
 */
export const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
const ATTRIBUTION = 'Book data from Open Library (openlibrary.org).';
const SCORE_SOURCE = 'Open Library readers';

const FIELDS = [
  'key',
  'title',
  'author_name',
  'author_key',
  'first_publish_year',
  'subject',
  'cover_i',
  'number_of_pages_median',
  'language',
  'ratings_average',
  'ratings_count',
  'edition_count',
].join(',');

const docSchema = z
  .object({
    key: z.string().regex(/^\/works\/OL\d+W$/, 'not a work key'),
    title: z.string().min(1),
    author_name: z.array(z.string()).nullish(),
    author_key: z.array(z.string()).nullish(),
    first_publish_year: z.number().int().nullish(),
    subject: z.array(z.string()).nullish(),
    cover_i: z.number().int().nullish(),
    number_of_pages_median: z.number().int().nullish(),
    language: z.array(z.string()).nullish(),
    ratings_average: z.number().nullish(),
    ratings_count: z.number().nullish(),
    edition_count: z.number().nullish(),
  })
  .passthrough();

const searchSchema = z.object({
  numFound: z.number().int(),
  start: z.number().int(),
  docs: z.array(z.unknown()),
});

/** Open Library subjects are free-form tags. Map the recognisable ones to genres. */
const GENRE_BY_SUBJECT: Record<string, string> = {
  fiction: 'Fiction',
  'science fiction': 'Science Fiction',
  'sci-fi': 'Science Fiction',
  fantasy: 'Fantasy',
  mystery: 'Mystery',
  'detective and mystery stories': 'Mystery',
  thriller: 'Thriller',
  suspense: 'Thriller',
  romance: 'Romance',
  horror: 'Horror',
  'historical fiction': 'Historical Fiction',
  biography: 'Biography',
  biographies: 'Biography',
  history: 'History',
  philosophy: 'Philosophy',
  psychology: 'Psychology',
  science: 'Science',
  technology: 'Technology',
  mathematics: 'Mathematics',
  engineering: 'Engineering',
  'self-help': 'Self-Help',
  poetry: 'Poetry',
  adventure: 'Adventure',
};

// Catalogue housekeeping tags, not topics.
const NOISE =
  /^(accessible book|protected daisy|in library|large type|overdrive|new york times|nyt:|reading level|lending library|internet archive|open library)/i;

const LANGUAGE_CODES: Record<string, string> = {
  eng: 'en', spa: 'es', fre: 'fr', ger: 'de', ita: 'it', por: 'pt', rus: 'ru',
  jpn: 'ja', chi: 'zh', kor: 'ko', hin: 'hi', ara: 'ar', dut: 'nl', swe: 'sv',
};

export function normalizeOpenLibraryDoc(raw: unknown): NormalizedTitle {
  const d = docSchema.parse(raw);
  const workId = d.key.replace('/works/', '');
  const subjects = (d.subject ?? []).filter((s) => s.length <= 60 && !NOISE.test(s));

  const genreSet: string[] = [];
  const themeSet: string[] = [];
  for (const s of subjects) {
    const genre = GENRE_BY_SUBJECT[s.toLowerCase()];
    if (genre) genreSet.push(genre);
    else if (themeSet.length < 12) themeSet.push(toDisplayCase(s));
  }

  const authors: NormalizedContributor[] = (d.author_name ?? []).slice(0, 6).map((name, i) => ({
    provider: 'openlibrary',
    externalId: `author:${d.author_key?.[i] ?? slugify(name)}`,
    kind: 'person',
    name,
    role: 'Author',
    order: i,
  }));

  const rated = d.ratings_count && d.ratings_count > 0 && d.ratings_average != null;

  return normalizedTitleSchema.parse({
    provider: 'openlibrary',
    externalId: workId,
    sourceUrl: `${OPEN_LIBRARY_BASE_URL}${d.key}`,
    attribution: ATTRIBUTION,
    payloadHash: hashPayload(raw),
    mediaType: 'book',
    format: 'Book',
    title: d.title,
    // A first-publication year means the work is out, not that a series is complete.
    status: d.first_publish_year ? 'finished' : 'unknown',
    releaseYear: d.first_publish_year ?? undefined,
    language: d.language?.map((l) => LANGUAGE_CODES[l]).find(Boolean),
    pages: d.number_of_pages_median ?? undefined,
    genres: normalizeGenres(genreSet),
    themes: normalizeGenres(themeSet),
    posterUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
    // Open Library rates out of 5; the catalog stores 0-10.
    ...(rated
      ? {
          providerScore: Math.round(d.ratings_average! * 2 * 100) / 100,
          providerScoreCount: Math.round(d.ratings_count!),
          providerScoreSource: SCORE_SOURCE,
        }
      : {}),
    popularity: d.edition_count ?? undefined,
    contributors: authors,
  });
}

export function createOpenLibraryAdapter(http: HttpClient, baseUrl: string = OPEN_LIBRARY_BASE_URL): ProviderAdapter {
  return {
    id: 'openlibrary',
    kinds: ['books'],
    isConfigured: () => ({ ok: true }),

    async listPage(kind, page, options = {}): Promise<ListPage> {
      if (kind !== 'books') throw new Error(`Open Library cannot list "${kind}"`);
      const q = options.subject
        ? `subject:"${options.subject.replace(/"/g, '')}"`
        : options.query?.trim();
      if (!q) throw new Error('Open Library listing needs a subject or a query');

      const limit = Math.min(options.limit ?? 50, 100);
      const sort = options.order === 'newest' ? '&sort=new' : '';
      const body = searchSchema.parse(
        await http.getJson(
          `${baseUrl}/search.json?q=${encodeURIComponent(q)}&fields=${FIELDS}&limit=${limit}&page=${page}${sort}`,
        ),
      );

      const items: NormalizedTitle[] = [];
      const errors: ProviderItemError[] = [];
      for (const raw of body.docs) {
        try {
          items.push(normalizeOpenLibraryDoc(raw));
        } catch (err) {
          const key = (raw as { key?: unknown } | null)?.key;
          errors.push({
            externalId: typeof key === 'string' ? key.replace('/works/', '') : undefined,
            message: err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(err),
          });
        }
      }
      return { page, items, errors, hasNext: body.start + body.docs.length < body.numFound };
    },
  };
}
