import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTestDb, rpc, seedTitle } from '../helpers/db';

interface Card {
  id: string;
  slug: string;
  title: string;
  media_type: string;
}
interface Result {
  total: number;
  limit: number;
  offset: number;
  items: Card[];
}

let db: PGlite;
const ids: Record<string, string> = {};

const search = (args: Record<string, unknown> = {}) =>
  as(db, { role: 'anon' }, () => rpc<Result>(db, 'search_titles', args));
const slugs = (r: Result) => r.items.map((i) => i.slug);

// Test fixtures only. These rows exist to exercise ranking and filters and are
// never loaded into a real catalog.
beforeAll(async () => {
  db = await createTestDb();
  const rows = [
    { slug: 'cowboy-bebop', title: 'Cowboy Bebop', release_year: 1998, genres: ['Action', 'Science Fiction'], themes: ['Space'], provider_score: 8.75, provider_score_count: 1_000_000, popularity: 1_900_000 },
    { slug: 'cowboy-bebop-movie', title: 'Cowboy Bebop: The Movie', release_year: 2001, genres: ['Action', 'Science Fiction'], themes: ['Space'], provider_score: 8.4, provider_score_count: 300_000, popularity: 500_000 },
    { slug: 'fmab', title: 'Fullmetal Alchemist: Brotherhood', release_year: 2009, genres: ['Action', 'Adventure', 'Fantasy'], provider_score: 9.1, provider_score_count: 2_000_000, popularity: 3_300_000, alt_names: ['Hagane no Renkinjutsushi: Fullmetal Alchemist', 'FMA Brotherhood'] },
    { slug: 'steins-gate', title: 'Steins;Gate', title_original: 'STEINS;GATE', release_year: 2011, genres: ['Science Fiction', 'Thriller'], themes: ['Time Travel'], provider_score: 9.07, provider_score_count: 1_400_000, popularity: 2_500_000, synopsis: 'A self-proclaimed mad scientist discovers a way to send messages to the past.' },
    { slug: 'tiny-masterpiece', title: 'Tiny Masterpiece', release_year: 2015, genres: ['Drama'], provider_score: 10, provider_score_count: 3, popularity: 10, status: 'releasing' },
    { slug: 'hidden-stub', title: 'Hidden Stub', is_stub: true },
    { slug: 'dune', title: 'Dune', media_type: 'book', release_year: 1965, genres: ['Science Fiction'], themes: ['Politics'], provider_score: 8.4, provider_score_count: 1000, pages: 688, popularity: 900 },
    { slug: 'blade-runner', title: 'Blade Runner', media_type: 'movie', release_year: 1982, genres: ['Science Fiction', 'Thriller'], provider_score: 7.9, provider_score_count: 10_000, popularity: 60 },
  ];
  for (const r of rows) ids[r.slug] = await seedTitle(db, r);
});
afterAll(async () => {
  await db.close();
});

describe('search_titles: matching', () => {
  it('matches word prefixes, ranking the closest title first', async () => {
    const r = await search({ p_q: 'cowboy' });
    expect(slugs(r)).toEqual(['cowboy-bebop', 'cowboy-bebop-movie']);
    expect(r.total).toBe(2);
  });

  it('ranks an exact title above longer titles that contain it', async () => {
    expect(slugs(await search({ p_q: 'Cowboy Bebop' }))[0]).toBe('cowboy-bebop');
  });

  it('tolerates typos through trigram similarity', async () => {
    expect(slugs(await search({ p_q: 'cowbow bebpo' }))).toContain('cowboy-bebop');
  });

  it('matches punctuation-separated titles and the original title', async () => {
    expect(slugs(await search({ p_q: 'steins gate' }))).toEqual(['steins-gate']);
    expect(slugs(await search({ p_q: 'steins;gate' }))).toEqual(['steins-gate']);
  });

  it('finds a title through any alternative name', async () => {
    expect(slugs(await search({ p_q: 'hagane no renkinjutsushi' }))).toEqual(['fmab']);
    expect(slugs(await search({ p_q: 'fma brother' }))).toContain('fmab');
  });

  it('searches the synopsis with lower weight than titles', async () => {
    expect(slugs(await search({ p_q: 'mad scientist' }))).toEqual(['steins-gate']);
  });

  it('never returns stub titles', async () => {
    expect(slugs(await search({ p_q: 'hidden stub' }))).toEqual([]);
    expect((await search()).total).toBe(7);
  });

  it('survives punctuation-only, quote and operator characters in the query', async () => {
    for (const q of ['!!!', "'; drop table titles; --", '"', '&|!:*', '   ', '(()']) {
      await expect(search({ p_q: q })).resolves.toMatchObject({ items: expect.any(Array) });
    }
  });
});

describe('search_titles: filters, sorting and paging', () => {
  it('filters by media type', async () => {
    expect(slugs(await search({ p_media_types: ['book'] }))).toEqual(['dune']);
    expect((await search({ p_media_types: ['movie', 'book'] })).total).toBe(2);
  });

  it('filters by genre overlap, year range, status and minimum score', async () => {
    expect((await search({ p_genres: ['Science Fiction'] })).total).toBe(5);
    expect(slugs(await search({ p_genres: ['Fantasy', 'Drama'], p_sort: 'title' }))).toEqual(['fmab', 'tiny-masterpiece']);
    expect(slugs(await search({ p_year_from: 2009, p_year_to: 2011, p_sort: 'oldest' }))).toEqual(['fmab', 'steins-gate']);
    expect(slugs(await search({ p_statuses: ['releasing'] }))).toEqual(['tiny-masterpiece']);
    expect(slugs(await search({ p_min_score: 9, p_sort: 'title' }))).toEqual(['fmab', 'steins-gate', 'tiny-masterpiece']);
  });

  it('combines a text query with filters', async () => {
    expect(slugs(await search({ p_q: 'cowboy', p_year_from: 2000 }))).toEqual(['cowboy-bebop-movie']);
  });

  it('sorts by weighted score so tiny samples cannot top the list', async () => {
    const order = slugs(await search({ p_sort: 'score' }));
    expect(order[0]).toBe('fmab'); // 9.1 from two million votes
    expect(order.indexOf('tiny-masterpiece')).toBeGreaterThan(order.indexOf('cowboy-bebop')); // 10.0 from 3 votes
  });

  it('sorts by popularity, newest, oldest and title', async () => {
    expect(slugs(await search({ p_sort: 'popularity' }))[0]).toBe('fmab');
    expect(slugs(await search({ p_sort: 'newest' }))[0]).toBe('tiny-masterpiece');
    expect(slugs(await search({ p_sort: 'oldest' }))[0]).toBe('dune');
    expect(slugs(await search({ p_sort: 'title' }))[0]).toBe('blade-runner');
  });

  it('pages results with a stable total', async () => {
    const page1 = await search({ p_sort: 'title', p_limit: 3, p_offset: 0 });
    const page2 = await search({ p_sort: 'title', p_limit: 3, p_offset: 3 });
    const page3 = await search({ p_sort: 'title', p_limit: 3, p_offset: 6 });
    expect(page1.total).toBe(7);
    expect([...slugs(page1), ...slugs(page2), ...slugs(page3)]).toEqual(
      (await search({ p_sort: 'title', p_limit: 100 })).items.map((i) => i.slug),
    );
    expect(page3.items).toHaveLength(1);
  });

  it('clamps absurd page sizes and rejects unknown sort keys', async () => {
    expect((await search({ p_limit: 100000 })).limit).toBe(100);
    expect((await search({ p_limit: 0 })).limit).toBe(1);
    await expect(search({ p_sort: 'random(); --' })).rejects.toThrow(/invalid_sort/);
  });
});

describe('suggestions, facets and similar titles', () => {
  it('suggests only for queries of two or more characters', async () => {
    const short = await as(db, { role: 'anon' }, () => rpc<unknown[]>(db, 'suggest_titles', { p_q: 'c' }));
    expect(short).toEqual([]);
    const some = await as(db, { role: 'anon' }, () => rpc<{ slug: string }[]>(db, 'suggest_titles', { p_q: 'co', p_limit: 5 }));
    expect(some.map((s) => s.slug)).toContain('cowboy-bebop');
  });

  it('reports genre counts and year bounds for a media type', async () => {
    const f = await as(db, { role: 'anon' }, () =>
      rpc<{ total: number; genres: { name: string; count: number }[]; years: { min: number; max: number } }>(db, 'title_facets', { p_media_types: ['anime'] }),
    );
    expect(f.total).toBe(5);
    expect(f.genres.find((g) => g.name === 'Action')?.count).toBe(3);
    expect(f.years).toEqual({ min: 1998, max: 2015 });
  });

  it('finds similar titles across media by shared genres and themes, never the title itself', async () => {
    const similar = await as(db, { role: 'anon' }, () =>
      rpc<{ slug: string; similarity: number; shared_tags: string[] }[]>(db, 'similar_titles_by_tags', { p_title_id: ids['cowboy-bebop'], p_limit: 10 }),
    );
    const order = similar.map((s) => s.slug);
    expect(order[0]).toBe('cowboy-bebop-movie'); // identical tags
    expect(order).toContain('dune'); // cross-media via Science Fiction
    expect(order).not.toContain('cowboy-bebop');
    expect(order).not.toContain('hidden-stub');
    expect(order).not.toContain('tiny-masterpiece'); // shares nothing
    expect(similar[0]!.similarity).toBe(1);
    expect(similar[0]!.shared_tags).toEqual(['Action', 'Science Fiction', 'Space']);
  });
});
