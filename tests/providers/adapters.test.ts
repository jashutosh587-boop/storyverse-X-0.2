import { describe, expect, it } from 'vitest';
import { normalizeJikanAnime, normalizeJikanManga, normalizeJikanRelations, createJikanAdapter } from '@/lib/providers/jikan';
import { createTmdbAdapter, normalizeTmdbMovie, normalizeTmdbTv } from '@/lib/providers/tmdb';
import { createOpenLibraryAdapter, normalizeOpenLibraryDoc } from '@/lib/providers/openlibrary';
import { createAdapter } from '@/lib/providers';
import type { HttpClient } from '@/lib/providers/http';
import {
  jikanAnimeMovie,
  jikanAnimeTv,
  jikanManga,
  jikanRelations,
  openLibraryDoc,
  tmdbDiscover,
  tmdbMovie,
  tmdbTv,
} from '../fixtures/providers';

/** An HttpClient that answers from a map of URL fragments and records requests. */
function stubHttp(routes: Array<[RegExp, unknown | Error]>) {
  const urls: string[] = [];
  const http: HttpClient = {
    async getJson(url) {
      urls.push(url);
      const hit = routes.find(([re]) => re.test(url));
      if (!hit) throw new Error(`no stub for ${url}`);
      if (hit[1] instanceof Error) throw hit[1];
      return hit[1];
    },
  };
  return { http, urls };
}

describe('Jikan anime', () => {
  it('normalizes a TV series', () => {
    const t = normalizeJikanAnime(jikanAnimeTv);
    expect(t).toMatchObject({
      provider: 'jikan',
      externalId: 'anime:1',
      mediaType: 'anime',
      format: 'TV',
      title: 'Cowboy Bebop',
      titleOriginal: 'カウボーイビバップ',
      status: 'finished',
      releaseDate: '1998-04-03',
      endDate: '1999-04-24',
      releaseYear: 1998,
      season: 'spring',
      seasonYear: 1998,
      country: 'JP',
      episodes: 26,
      runtimeMinutes: 24,
      providerScore: 8.75,
      providerScoreCount: 1_000_000,
      providerScoreSource: 'MyAnimeList',
      popularity: 1_900_000,
      posterUrl: 'https://cdn.myanimelist.net/images/anime/4/19644l.webp',
    });
    expect(t.genres).toEqual(['Action', 'Science Fiction']);
    expect(t.themes).toEqual(['Space']);
    expect(t.attribution).toMatch(/Jikan/);
    expect(t.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.contributors.map((c) => [c.role, c.name, c.kind])).toEqual([
      ['Studio', 'Sunrise', 'studio'],
      ['Producer', 'Bandai Visual', 'company'],
    ]);
  });

  it('keeps alternative names, drops the default title and duplicates', () => {
    const names = normalizeJikanAnime(jikanAnimeTv).altNames;
    expect(names.map((n) => n.name)).toEqual(['カウボーイビバップ', 'CB', 'Cowboy Bebop (FR)']);
    expect(names.find((n) => n.name === 'カウボーイビバップ')).toMatchObject({ lang: 'ja', kind: 'native' });
  });

  it('handles a movie with missing fields without inventing values', () => {
    const t = normalizeJikanAnime(jikanAnimeMovie);
    expect(t.format).toBe('Movie');
    expect(t.runtimeMinutes).toBe(115);
    expect(t.providerScore).toBeUndefined(); // 0 means "unscored" on MyAnimeList
    expect(t.synopsis).toBeUndefined();
    expect(t.season).toBeUndefined();
    expect(t.posterUrl).toBeUndefined(); // the placeholder icon is not a poster
    expect(t.releaseYear).toBe(2001);
    expect(t.endDate).toBeUndefined();
  });

  it('rejects a record that has no usable title', () => {
    expect(() => normalizeJikanAnime({ mal_id: 3, title: '' })).toThrow();
    expect(() => normalizeJikanAnime({ title: 'No id' })).toThrow();
  });
});

describe('Jikan manga and novels', () => {
  it('normalizes a manga, flipping "Last, First" author names', () => {
    const t = normalizeJikanManga(jikanManga);
    expect(t).toMatchObject({ mediaType: 'manga', format: 'Manga', status: 'hiatus', volumes: 42, releaseYear: 1989, country: 'JP' });
    expect(t.chapters).toBeUndefined();
    expect(t.contributors).toMatchObject([{ name: 'Kentarou Miura', role: 'Author', kind: 'person' }]);
    expect(t.themes).toEqual(['Gore', 'Seinen']);
  });

  it('maps light novels to the novel type and manhwa to Korea', () => {
    expect(normalizeJikanManga({ ...jikanManga, type: 'Light Novel' }).mediaType).toBe('novel');
    expect(normalizeJikanManga({ ...jikanManga, type: 'Manhwa' })).toMatchObject({ mediaType: 'manga', country: 'KR', language: 'ko' });
  });
});

describe('Jikan relations', () => {
  it('maps labels, orients adaptations by media type and skips non-titles', () => {
    const fromAnime = normalizeJikanRelations('anime', jikanRelations);
    expect(fromAnime.map((r) => [r.relation, r.target.externalId, r.target.mediaType])).toEqual([
      ['adapted_from', 'manga:173', 'manga'],
      ['sequel', 'anime:5', 'anime'],
      ['spin_off', 'anime:99', 'anime'],
      ['other', 'anime:7', 'anime'],
      ['other', 'anime:8', 'anime'], // unknown labels degrade to "other"
    ]);
    const fromManga = normalizeJikanRelations('manga', {
      data: [{ relation: 'Adaptation', entry: [{ mal_id: 1, type: 'anime', name: 'Cowboy Bebop' }] }],
    });
    expect(fromManga[0]!.relation).toBe('adapted_into');
  });
});

describe('Jikan adapter', () => {
  it('requests a safe-for-work page with pagination and sorting', async () => {
    const { http, urls } = stubHttp([[/\/anime\?/, { pagination: { has_next_page: true }, data: [jikanAnimeTv] }]]);
    const page = await createJikanAdapter(http).listPage('anime', 3, { order: 'score' });
    expect(urls[0]).toBe('https://api.jikan.moe/v4/anime?page=3&limit=25&sfw=true&order_by=score&sort=desc');
    expect(page).toMatchObject({ page: 3, hasNext: true, errors: [] });
    expect(page.items).toHaveLength(1);
  });

  it('keeps good items when one record on the page is malformed', async () => {
    const { http } = stubHttp([[/\/manga\?/, { pagination: { has_next_page: false }, data: [jikanManga, { mal_id: 77, title: '' }] }]]);
    const page = await createJikanAdapter(http).listPage('manga', 1);
    expect(page.items).toHaveLength(1);
    expect(page.errors).toHaveLength(1);
    expect(page.errors[0]!.externalId).toBe('manga:77');
    expect(page.hasNext).toBe(false);
  });

  it('fetches relations for a title and rejects unsupported kinds', async () => {
    const { http, urls } = stubHttp([[/relations/, jikanRelations]]);
    const rels = await createJikanAdapter(http).fetchRelations!('anime', 'anime:1');
    expect(urls[0]).toBe('https://api.jikan.moe/v4/anime/1/relations');
    expect(rels.length).toBeGreaterThan(0);
    await expect(createJikanAdapter(http).listPage('movie', 1)).rejects.toThrow(/cannot list/);
  });

  it('only puts a plain number into the relations request path', async () => {
    const { http, urls } = stubHttp([[/relations/, jikanRelations]]);
    const adapter = createJikanAdapter(http);
    await expect(adapter.fetchRelations!('anime', '7')).resolves.toBeDefined(); // a bare id still works
    for (const bad of ['anime:../../x', 'manga:1/other', 'anime:', '1?x=y', 'manga:12345678901']) {
      await expect(adapter.fetchRelations!('anime', bad)).rejects.toThrow(/Invalid Jikan/);
    }
    expect(urls).toEqual(['https://api.jikan.moe/v4/anime/7/relations']);
  });

  it('keeps an anime and a manga with the same MyAnimeList number apart', () => {
    // anime/1 and manga/1 are different works on MyAnimeList.
    const anime = normalizeJikanAnime({ ...jikanAnimeTv, mal_id: 1 });
    const manga = normalizeJikanManga({ ...jikanManga, mal_id: 1 });
    expect(anime.externalId).toBe('anime:1');
    expect(manga.externalId).toBe('manga:1');
    expect(normalizeJikanManga({ ...jikanManga, mal_id: 1, type: 'Light Novel' }).externalId).toBe('manga:1');
    expect(normalizeJikanRelations('manga', { data: [{ relation: 'Adaptation', entry: [{ mal_id: 1, type: 'anime', name: 'x' }] }] })[0]!.target.externalId).toBe('anime:1');
  });

  it('identifies a company the same way whether it is credited as studio or producer', () => {
    const t = normalizeJikanAnime({
      ...jikanAnimeTv,
      studios: [{ mal_id: 14, name: 'Sunrise' }],
      producers: [{ mal_id: 14, name: 'Sunrise' }, { mal_id: 23, name: 'Bandai Visual' }],
    });
    expect(t.contributors.map((c) => [c.role, c.externalId])).toEqual([
      ['Studio', 'company:14'],
      ['Producer', 'company:14'],
      ['Producer', 'company:23'],
    ]);
    expect(normalizeJikanManga(jikanManga).contributors[0]!.externalId).toBe('person:1868');
  });

  it('fails the whole page when the response envelope is wrong', async () => {
    const { http } = stubHttp([[/\/anime\?/, { nope: true }]]);
    await expect(createJikanAdapter(http).listPage('anime', 1)).rejects.toThrow();
  });
});

describe('TMDB', () => {
  it('normalizes a movie with images, credits and genres', () => {
    const t = normalizeTmdbMovie(tmdbMovie);
    expect(t).toMatchObject({
      provider: 'tmdb',
      externalId: 'movie:78',
      mediaType: 'movie',
      title: 'Blade Runner',
      status: 'finished',
      releaseDate: '1982-06-25',
      releaseYear: 1982,
      runtimeMinutes: 117,
      country: 'US',
      language: 'en',
      providerScore: 7.9,
      providerScoreCount: 14000,
      posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg',
    });
    expect(t.titleOriginal).toBeUndefined(); // same as the title
    expect(t.genres).toEqual(['Science Fiction', 'Thriller']);
    expect(t.attribution).toBe('This product uses the TMDB API but is not endorsed or certified by TMDB.');
    expect(t.contributors.map((c) => [c.role, c.name])).toEqual([
      ['Director', 'A Director'],
      ['Cast', 'First Billed'],
      ['Cast', 'Second Billed'],
    ]);
  });

  it('normalizes a TV series, treating zero votes as unrated and expanding combined genres', () => {
    const t = normalizeTmdbTv(tmdbTv);
    expect(t).toMatchObject({
      externalId: 'tv:1396',
      mediaType: 'tv',
      status: 'finished',
      endDate: '2013-09-29',
      episodes: 62,
      runtimeMinutes: 47,
      country: 'US',
      titleOriginal: 'Eine Fixture-Serie',
    });
    expect(t.providerScore).toBeUndefined();
    expect(t.synopsis).toBeUndefined(); // empty overview is not a synopsis
    expect(t.posterUrl).toBeUndefined();
    expect(t.genres).toEqual(['Science Fiction', 'Fantasy', 'Drama']);
    expect(t.contributors[0]).toMatchObject({ role: 'Creator', name: 'A Creator' });
  });

  it('reports a missing token instead of pretending to be connected', () => {
    const { http } = stubHttp([]);
    expect(createTmdbAdapter(http, undefined).isConfigured()).toEqual({ ok: false, missing: ['TMDB_READ_ACCESS_TOKEN'] });
    expect(createTmdbAdapter(http, 'token').isConfigured()).toEqual({ ok: true });
  });

  it('lists a discover page, fetching each title, and records the ones that fail', async () => {
    const { http, urls } = stubHttp([
      [/discover\/movie/, tmdbDiscover],
      [/\/movie\/78\?/, tmdbMovie],
      [/\/movie\/999999\?/, new Error('HTTP 404')],
    ]);
    const page = await createTmdbAdapter(http, 'token').listPage('movie', 1);
    expect(urls[0]).toContain('/discover/movie?include_adult=false&language=en-US&sort_by=popularity.desc&page=1');
    expect(urls[1]).toContain('append_to_response=credits');
    expect(page.items.map((i) => i.externalId)).toEqual(['movie:78']);
    expect(page.errors).toEqual([{ externalId: 'movie:999999', message: expect.stringContaining('404') }]);
    expect(page.hasNext).toBe(true);
  });

  it('stops at TMDB\'s 500-page ceiling', async () => {
    const { http, urls } = stubHttp([]);
    const page = await createTmdbAdapter(http, 'token').listPage('tv', 501);
    expect(page).toMatchObject({ items: [], hasNext: false });
    expect(urls).toHaveLength(0);
  });
});

describe('Open Library', () => {
  it('normalizes a work: genres vs themes, ratings scaled to 10, cover, language', () => {
    const t = normalizeOpenLibraryDoc(openLibraryDoc);
    expect(t).toMatchObject({
      provider: 'openlibrary',
      externalId: 'OL893415W',
      mediaType: 'book',
      title: 'Dune',
      releaseYear: 1965,
      pages: 604,
      language: 'en',
      providerScore: 8.4,
      providerScoreCount: 1500,
      providerScoreSource: 'Open Library readers',
      posterUrl: 'https://covers.openlibrary.org/b/id/12345-L.jpg',
      sourceUrl: 'https://openlibrary.org/works/OL893415W',
    });
    expect(t.genres).toEqual(['Science Fiction', 'Fiction']);
    expect(t.themes).toEqual(['Politics', 'Space Flight']); // housekeeping tags and the long one are dropped
    expect(t.contributors).toMatchObject([{ name: 'Frank Herbert', role: 'Author', externalId: 'author:OL79034A' }]);
  });

  it('leaves unrated works unscored', () => {
    expect(normalizeOpenLibraryDoc({ ...openLibraryDoc, ratings_count: 0, ratings_average: 0 }).providerScore).toBeUndefined();
    expect(normalizeOpenLibraryDoc({ ...openLibraryDoc, ratings_count: undefined, ratings_average: undefined }).providerScore).toBeUndefined();
  });

  it('rejects documents that are not works', () => {
    expect(() => normalizeOpenLibraryDoc({ ...openLibraryDoc, key: '/books/OL1M' })).toThrow();
  });

  it('searches by subject with the field list and paging', async () => {
    const { http, urls } = stubHttp([[/search\.json/, { numFound: 120, start: 0, docs: [openLibraryDoc, { key: '/books/bad', title: 'x' }] }]]);
    const page = await createOpenLibraryAdapter(http).listPage('books', 2, { subject: 'aerospace engineering', limit: 50 });
    expect(urls[0]).toContain('q=subject%3A%22aerospace%20engineering%22');
    expect(urls[0]).toContain('page=2');
    expect(urls[0]).toContain('limit=50');
    expect(page.items).toHaveLength(1);
    expect(page.errors).toHaveLength(1);
    expect(page.hasNext).toBe(true);
  });

  it('requires a subject or a query', async () => {
    await expect(createOpenLibraryAdapter(stubHttp([]).http).listPage('books', 1)).rejects.toThrow(/subject or a query/);
  });
});

describe('adapter registry', () => {
  it('builds each provider and exposes its configuration status', () => {
    const env = { INGEST_CONTACT: 'me@example.test' };
    expect(createAdapter('jikan', { env }).kinds).toEqual(['anime', 'manga']);
    expect(createAdapter('openlibrary', { env }).kinds).toEqual(['books']);
    expect(createAdapter('tmdb', { env }).isConfigured()).toMatchObject({ ok: false });
    expect(createAdapter('tmdb', { env: { ...env, TMDB_READ_ACCESS_TOKEN: 't' } }).isConfigured()).toEqual({ ok: true });
  });
});
