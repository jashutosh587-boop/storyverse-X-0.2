/**
 * TEST ONLY. Fills the stand-in database with a small catalog by running the
 * real normalizers and the real ingestion code over hand-written fixtures plus
 * generated filler. Every title here is test data: none of it came from a live
 * provider, and the filler titles say so in their names.
 */
import type { PGlite } from '@electric-sql/pglite';
import { ingestRelations, ingestTitle } from '../../src/lib/ingest/ingest';
import { normalizeJikanAnime, normalizeJikanManga, normalizeJikanRelations } from '../../src/lib/providers/jikan';
import { normalizeOpenLibraryDoc } from '../../src/lib/providers/openlibrary';
import { normalizeTmdbMovie, normalizeTmdbTv } from '../../src/lib/providers/tmdb';
import { pgliteDb } from '../../tests/helpers/db';
import { jikanAnimeMovie, jikanAnimeTv, jikanManga, jikanRelations, openLibraryDoc, tmdbMovie, tmdbTv } from '../../tests/fixtures/providers';

/** A small deterministic random number generator, so every run seeds the same catalog. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Romance', 'Sci-Fi', 'Slice of Life', 'Mystery', 'Horror'];
const THEMES = ['School', 'Music', 'Military', 'Time Travel', 'Isekai', 'Mecha'];
const STATUSES = ['Finished Airing', 'Currently Airing', 'Not yet aired'];

export const FILLER_COUNT = 40;

export async function seed(pg: PGlite): Promise<{ titles: number }> {
  const db = pgliteDb(pg);
  const rand = mulberry32(20261103);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;

  const real = [
    normalizeJikanAnime(jikanAnimeTv),
    normalizeJikanAnime(jikanAnimeMovie),
    normalizeJikanManga(jikanManga),
    normalizeTmdbMovie(tmdbMovie),
    normalizeTmdbTv(tmdbTv),
    normalizeOpenLibraryDoc(openLibraryDoc),
  ];
  for (const title of real) await ingestTitle(db, title);

  // Filler anime so that paging, filtering and sorting have something to work on.
  for (let i = 1; i <= FILLER_COUNT; i += 1) {
    const n = String(i).padStart(3, '0');
    const genres = [...new Set([pick(GENRES), pick(GENRES)])];
    const year = 1990 + Math.floor(rand() * 36);
    const scored = 100 + Math.floor(rand() * 400_000);
    const withPoster = i % 3 !== 0; // every third has no artwork, to exercise the placeholder
    await ingestTitle(
      db,
      normalizeJikanAnime({
        mal_id: 9000 + i,
        url: `https://myanimelist.net/anime/${9000 + i}`,
        images: withPoster ? { jpg: { large_image_url: `https://cdn.myanimelist.net/images/anime/e2e/${n}l.jpg` } } : {},
        titles: [{ type: 'Default', title: `E2E Test Anime ${n}` }],
        title: `E2E Test Anime ${n}`,
        type: pick(['TV', 'TV', 'Movie', 'OVA'] as const),
        episodes: 1 + Math.floor(rand() * 50),
        status: pick(STATUSES),
        aired: { from: `${year}-04-01T00:00:00+00:00`, to: null },
        duration: '24 min per ep',
        score: Math.round((5 + rand() * 4.2) * 100) / 100,
        scored_by: scored,
        members: scored * 3,
        synopsis: `Generated test entry number ${n}. It exists only so the end-to-end tests have a catalog to browse.`,
        season: pick(['winter', 'spring', 'summer', 'fall'] as const),
        year,
        studios: [{ mal_id: 100 + (i % 5), name: `Test Studio ${(i % 5) + 1}` }],
        genres: genres.map((name, k) => ({ mal_id: 500 + k, name })),
        themes: [{ mal_id: 600, name: pick(THEMES) }],
        demographics: [],
      }),
    );
  }

  // Cowboy Bebop (anime:1) is linked to its film, which is in the catalog, and to titles that are not.
  await ingestRelations(db, 'jikan', 'anime:1', normalizeJikanRelations('anime', jikanRelations));

  const count = await pg.query<{ n: number }>('select count(*)::int as n from public.titles where not is_stub');
  return { titles: count.rows[0]!.n };
}
