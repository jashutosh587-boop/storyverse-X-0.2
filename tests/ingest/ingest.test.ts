import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db, Queryable } from '@/lib/ingest/db';
import { ingestRelations, ingestTitle } from '@/lib/ingest/ingest';
import { findResumePage, jobKey, MissingCredentialsError, runIngestion } from '@/lib/ingest/run';
import { normalizeJikanAnime, normalizeJikanManga, normalizeJikanRelations } from '@/lib/providers/jikan';
import { normalizeOpenLibraryDoc } from '@/lib/providers/openlibrary';
import { normalizeTmdbMovie } from '@/lib/providers/tmdb';
import type { ListPage, NormalizedRelation, NormalizedTitle, ProviderAdapter } from '@/lib/providers/types';
import { jikanAnimeTv, jikanManga, jikanRelations, openLibraryDoc, tmdbMovie } from '../fixtures/providers';
import { as, createTestDb, pgliteDb, rpc } from '../helpers/db';

let pg: PGlite;
const db = () => pgliteDb(pg);

beforeAll(async () => {
  pg = await createTestDb();
});
afterAll(async () => {
  await pg.close();
});

const count = async (sql: string, params: unknown[] = []) =>
  Number((await pg.query<{ n: string | number | bigint }>(sql, params)).rows[0]!.n);

const slugOf = async (id: string) =>
  (await pg.query<{ slug: string }>(`select slug from public.titles where id = $1`, [id])).rows[0]!.slug;

/** Call a public function the way an anonymous visitor would. */
const publicRpc = <T>(fn: string, args: Record<string, unknown>) => as(pg, { role: 'anon' }, () => rpc<T>(pg, fn, args));

/** A Jikan anime payload that differs from the base fixture only where a test says so. */
const animeRaw = (id: number, over: Record<string, unknown> = {}) => {
  const title = typeof over.title === 'string' ? over.title : `Fixture Anime ${id}`;
  return {
    ...jikanAnimeTv,
    mal_id: id,
    url: `https://myanimelist.net/anime/${id}`,
    title,
    titles: [{ type: 'Default', title }],
    ...over,
  };
};
const anime = (id: number, over: Record<string, unknown> = {}) => normalizeJikanAnime(animeRaw(id, over));

const rel = (relation: NormalizedRelation['relation'], id: number, title: string): NormalizedRelation => ({
  relation,
  target: { provider: 'jikan', externalId: `anime:${id}`, mediaType: 'anime', title },
});

/** A Db whose transactions throw when `shouldFail` says so, to prove nothing is left half-written. */
function failingDb(shouldFail: (text: string, params: unknown[] | undefined) => boolean): Db {
  const base = db();
  const guard = (q: Queryable): Queryable => ({
    query: (async (text: string, params?: unknown[]) => {
      if (shouldFail(text, params)) throw new Error('injected failure');
      return q.query(text, params);
    }) as Queryable['query'],
  });
  return { ...base, transaction: (fn) => base.transaction((q) => fn(guard(q))) };
}

describe('ingestTitle', () => {
  it('stores the title with alt names, credits, tags and provenance', async () => {
    const t = normalizeJikanAnime(jikanAnimeTv);
    const res = await ingestTitle(db(), t);
    expect(res.action).toBe('inserted');

    const row = (await pg.query<Record<string, unknown>>(`select * from public.titles where id = $1`, [res.titleId])).rows[0]!;
    expect(row).toMatchObject({
      media_type: 'anime',
      format: 'TV',
      title: 'Cowboy Bebop',
      title_original: 'カウボーイビバップ',
      status: 'finished',
      release_year: 1998,
      season: 'spring',
      season_year: 1998,
      episodes: 26,
      runtime_minutes: 24,
      is_stub: false,
      provider_score_source: 'MyAnimeList',
      genres: ['Action', 'Science Fiction'],
      themes: ['Space'],
    });
    expect(Number(row.provider_score)).toBe(8.75);
    expect(row.slug).toMatch(/^cowboy-bebop-[0-9a-f]{6}$/);
    const dates = (await pg.query<{ d: string; e: string }>(`select release_date::text d, end_date::text e from public.titles where id = $1`, [res.titleId])).rows[0]!;
    expect(dates).toEqual({ d: '1998-04-03', e: '1999-04-24' });

    expect(await count(`select count(*) n from public.title_alt_names where title_id = $1`, [res.titleId])).toBe(3);
    const credits = await pg.query<{ role: string; name: string }>(
      `select tc.role, c.name from public.title_contributors tc
         join public.contributors c on c.id = tc.contributor_id
        where tc.title_id = $1 order by tc.role`,
      [res.titleId],
    );
    expect(credits.rows).toEqual([
      { role: 'Producer', name: 'Bandai Visual' },
      { role: 'Studio', name: 'Sunrise' },
    ]);

    const sources = (await pg.query<{ provider: string; external_id: string; payload_hash: string; attribution: string; url: string }>(
      `select provider, external_id, payload_hash, attribution, url from public.title_sources where title_id = $1`,
      [res.titleId],
    )).rows;
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ provider: 'jikan', external_id: 'anime:1', payload_hash: t.payloadHash });
    expect(sources[0]!.attribution).toMatch(/Jikan/);
    expect(sources[0]!.url).toBe('https://myanimelist.net/anime/1/Cowboy_Bebop');
  });

  it('is idempotent: an unchanged payload is not rewritten', async () => {
    const titles = await count(`select count(*) n from public.titles`);
    const again = await ingestTitle(db(), normalizeJikanAnime(jikanAnimeTv));
    expect(again.action).toBe('unchanged');
    expect(await count(`select count(*) n from public.titles`)).toBe(titles);
    expect(await count(`select count(*) n from public.title_alt_names where title_id = $1`, [again.titleId])).toBe(3);
  });

  it('updates in place when the provider data changes, replacing alt names and credits', async () => {
    const first = await ingestTitle(db(), normalizeJikanAnime(jikanAnimeTv));
    const res = await ingestTitle(
      db(),
      normalizeJikanAnime({
        ...jikanAnimeTv,
        score: 8.9,
        members: 2_000_000,
        studios: [{ mal_id: 15, name: 'Another Studio' }],
        titles: [
          { type: 'Default', title: 'Cowboy Bebop' },
          { type: 'English', title: 'Cowboy Bebop (Remaster)' },
        ],
      }),
    );
    expect(res).toEqual({ titleId: first.titleId, action: 'updated' });

    const row = (await pg.query<{ provider_score: string; popularity: number; slug: string }>(`select slug, provider_score, popularity from public.titles where id = $1`, [res.titleId])).rows[0]!;
    expect(Number(row.provider_score)).toBe(8.9);
    expect(row.popularity).toBe(2_000_000);
    expect(row.slug).toMatch(/^cowboy-bebop-[0-9a-f]{6}$/); // links to the title keep working
    const names = (await pg.query<{ name: string }>(`select name from public.title_alt_names where title_id = $1`, [res.titleId])).rows;
    expect(names).toEqual([{ name: 'Cowboy Bebop (Remaster)' }]);
    const studios = (await pg.query<{ name: string }>(
      `select c.name from public.title_contributors tc join public.contributors c on c.id = tc.contributor_id
        where tc.title_id = $1 and tc.role = 'Studio'`,
      [res.titleId],
    )).rows;
    expect(studios).toEqual([{ name: 'Another Studio' }]);
    expect(await count(`select count(*) n from public.title_sources where title_id = $1`, [res.titleId])).toBe(1);
  });

  it('shares one contributor between titles, follows its name but keeps its kind', async () => {
    await ingestTitle(db(), anime(2001, { studios: [{ mal_id: 500, name: 'Shared Studio' }], producers: [] }));
    await ingestTitle(db(), anime(2002, { studios: [], producers: [{ mal_id: 500, name: 'Shared Studio Renamed' }] }));

    const rows = (await pg.query<{ name: string; kind: string; credits: string | number; roles: string[] }>(
      `select c.name, c.kind, count(*) credits, array_agg(tc.role order by tc.role) roles
         from public.contributor_sources s
         join public.contributors c on c.id = s.contributor_id
         join public.title_contributors tc on tc.contributor_id = c.id
        where s.provider = 'jikan' and s.external_id = 'company:500'
        group by c.name, c.kind`,
    )).rows;
    expect(rows).toHaveLength(1); // one contributor, not one per title
    expect(rows[0]).toMatchObject({ name: 'Shared Studio Renamed', kind: 'studio', roles: ['Producer', 'Studio'] });
    expect(Number(rows[0]!.credits)).toBe(2);
  });

  it('keeps both credits when one company is studio and producer of the same title', async () => {
    const res = await ingestTitle(
      db(),
      anime(2003, { studios: [{ mal_id: 501, name: 'Both Roles' }], producers: [{ mal_id: 501, name: 'Both Roles' }] }),
    );
    const roles = await pg.query<{ role: string }>(`select role from public.title_contributors where title_id = $1 order by role`, [res.titleId]);
    expect(roles.rows).toEqual([{ role: 'Producer' }, { role: 'Studio' }]);
    expect(await count(`select count(distinct contributor_id) n from public.title_contributors where title_id = $1`, [res.titleId])).toBe(1);
  });

  it('keeps an anime and a manga with the same MyAnimeList number apart', async () => {
    const a = await ingestTitle(db(), anime(7001, { title: 'Seven Thousand Anime' }));
    const m = await ingestTitle(db(), normalizeJikanManga({ ...jikanManga, mal_id: 7001, title: 'Seven Thousand Manga', titles: [{ type: 'Default', title: 'Seven Thousand Manga' }] }));
    expect(a.action).toBe('inserted');
    expect(m.action).toBe('inserted');
    expect(a.titleId).not.toBe(m.titleId);
    const sources = await pg.query<{ external_id: string; media_type: string }>(
      `select s.external_id, t.media_type from public.title_sources s join public.titles t on t.id = s.title_id
        where s.provider = 'jikan' and s.external_id like '%:7001' order by 1`,
    );
    expect(sources.rows).toEqual([
      { external_id: 'anime:7001', media_type: 'anime' },
      { external_id: 'manga:7001', media_type: 'manga' },
    ]);
    // each is still recognised as itself on the next run
    expect((await ingestTitle(db(), anime(7001, { title: 'Seven Thousand Anime' }))).action).toBe('unchanged');
  });

  it('ingests every medium into one catalog', async () => {
    await ingestTitle(db(), normalizeJikanManga(jikanManga));
    await ingestTitle(db(), normalizeTmdbMovie(tmdbMovie));
    await ingestTitle(db(), normalizeOpenLibraryDoc(openLibraryDoc));
    const types = await pg.query<{ media_type: string }>(`select distinct media_type from public.titles where not is_stub order by 1`);
    expect(types.rows.map((r) => r.media_type)).toEqual(['anime', 'book', 'manga', 'movie']);
    const providers = await pg.query<{ provider: string }>(`select distinct provider from public.title_sources order by 1`);
    expect(providers.rows.map((r) => r.provider)).toEqual(['jikan', 'openlibrary', 'tmdb']);
  });

  it('refuses invalid data before it reaches the database', async () => {
    const good = anime(4242);
    const before = await count(`select count(*) n from public.titles`);
    await expect(ingestTitle(db(), { ...good, releaseYear: 99999 })).rejects.toThrow();
    await expect(ingestTitle(db(), { ...good, title: '   ' })).rejects.toThrow();
    await expect(ingestTitle(db(), { ...good, providerScore: 11 })).rejects.toThrow();
    await expect(ingestTitle(db(), { ...good, payloadHash: 'not-a-hash' })).rejects.toThrow();
    expect(await count(`select count(*) n from public.titles`)).toBe(before);
  });

  it('leaves nothing behind when a step fails part-way', async () => {
    const titles = await count(`select count(*) n from public.titles`);
    const broken = failingDb((text) => /insert into public\.title_sources/.test(text));
    await expect(
      ingestTitle(broken, anime(8001, { studios: [{ mal_id: 8800, name: 'Rolled Back Studio' }] })),
    ).rejects.toThrow('injected failure');
    expect(await count(`select count(*) n from public.titles`)).toBe(titles);
    expect(await count(`select count(*) n from public.contributors where name = 'Rolled Back Studio'`)).toBe(0);
    expect(await count(`select count(*) n from public.contributor_sources where external_id = 'company:8800'`)).toBe(0);
    // and the same record ingests normally afterwards
    expect((await ingestTitle(db(), anime(8001))).action).toBe('inserted');
  });

  it('makes the new title findable through the public API', async () => {
    const found = await publicRpc<{ total: number; items: { slug: string; title: string }[] }>('search_titles', { p_q: 'bebop' });
    expect(found.items.map((i) => i.title)).toContain('Cowboy Bebop');
    const slug = found.items.find((i) => i.title === 'Cowboy Bebop')!.slug;
    const page = await publicRpc<{ title: { title: string }; sources: { provider: string; attribution: string }[] }>('get_title', { p_slug: slug });
    expect(page.title.title).toBe('Cowboy Bebop');
    expect(page.sources).toMatchObject([{ provider: 'jikan', attribution: expect.stringMatching(/Jikan/) }]);
  });
});

describe('ingestRelations', () => {
  it('links existing titles, creates hidden stubs for the rest, and fills a stub when the real record arrives', async () => {
    const source = await ingestTitle(db(), anime(3001, { title: 'Relation Source' }));
    const sequel = await ingestTitle(db(), anime(5, { title: 'Cowboy Bebop: Tengoku no Tobira', studios: [], producers: [] }));

    const res = await ingestRelations(db(), 'jikan', 'anime:3001', normalizeJikanRelations('anime', jikanRelations));
    expect(res).toEqual({ edges: 5, stubsCreated: 4, stubsRemoved: 0 }); // the sequel already existed

    // a stub is a real row, but invisible to search and to its own page
    const stub = (await pg.query<{ id: string; slug: string; title: string; media_type: string }>(
      `select t.id, t.slug, t.title, t.media_type from public.titles t
         join public.title_sources s on s.title_id = t.id
        where t.is_stub and s.provider = 'jikan' and s.external_id = 'manga:173'`,
    )).rows[0]!;
    expect(stub).toMatchObject({ title: 'Cowboy Bebop: Shooting Star', media_type: 'manga' });
    expect((await publicRpc<{ items: unknown[] }>('search_titles', { p_q: 'Shooting Star' })).items).toEqual([]);
    expect(await publicRpc('get_title', { p_slug: stub.slug })).toBeNull();

    // the graph still shows the connection, flagged so the UI does not link to a page that does not exist
    type View = { relations: { relation: string; title: { title: string; is_stub: boolean } }[] };
    const view = await publicRpc<View>('get_title', { p_slug: await slugOf(source.titleId) });
    expect(view.relations).toHaveLength(5);
    const shown = view.relations.map((r) => [r.relation, r.title.title, r.title.is_stub]);
    expect(shown).toContainEqual(['adapted_from', 'Cowboy Bebop: Shooting Star', true]);
    expect(shown).toContainEqual(['sequel', 'Cowboy Bebop: Tengoku no Tobira', false]);

    // and the other side sees the inverse relation
    const back = await publicRpc<View>('get_title', { p_slug: await slugOf(sequel.titleId) });
    expect(back.relations.map((r) => [r.relation, r.title.title])).toContainEqual(['prequel', 'Relation Source']);

    // ingesting the real record fills the same row: same id, same slug, edges kept
    const filled = await ingestTitle(
      db(),
      normalizeJikanManga({ ...jikanManga, mal_id: 173, title: 'Cowboy Bebop: Shooting Star', titles: [{ type: 'Default', title: 'Cowboy Bebop: Shooting Star' }] }),
    );
    expect(filled).toEqual({ titleId: stub.id, action: 'updated' });
    const after = (await pg.query<Record<string, unknown>>(`select slug, is_stub, volumes, status from public.titles where id = $1`, [stub.id])).rows[0]!;
    expect(after).toEqual({ slug: stub.slug, is_stub: false, volumes: 42, status: 'hiatus' });
    expect(await count(`select count(*) n from public.title_relations where to_title_id = $1`, [stub.id])).toBe(1);
    expect(await publicRpc('get_title', { p_slug: stub.slug })).not.toBeNull();
  });

  it('can be repeated without changing the graph', async () => {
    const edges = () => count(`select count(*) n from public.title_relations`);
    const before = await edges();
    const again = await ingestRelations(db(), 'jikan', 'anime:3001', normalizeJikanRelations('anime', jikanRelations));
    expect(again).toEqual({ edges: 5, stubsCreated: 0, stubsRemoved: 0 });
    expect(await edges()).toBe(before);
  });

  it('replaces earlier edges, skips links to itself and removes stubs nothing points to any more', async () => {
    await ingestTitle(db(), anime(3002, { title: 'Replace Source' }));
    const first = await ingestRelations(db(), 'jikan', 'anime:3002', [
      rel('sequel', 3101, 'Stub One'),
      rel('prequel', 3102, 'Stub Two'),
      rel('other', 3002, 'Itself'),
    ]);
    expect(first).toEqual({ edges: 2, stubsCreated: 2, stubsRemoved: 0 });

    const second = await ingestRelations(db(), 'jikan', 'anime:3002', [rel('sequel', 3101, 'Stub One')]);
    expect(second).toEqual({ edges: 1, stubsCreated: 0, stubsRemoved: 1 });
    expect(await count(`select count(*) n from public.title_sources where external_id = 'anime:3102'`)).toBe(0);
    expect(await count(`select count(*) n from public.title_sources where external_id = 'anime:3101'`)).toBe(1);
    expect(await count(`select count(*) n from public.titles where title = 'Stub Two'`)).toBe(0);
  });

  it('keeps a stub that another title still points to', async () => {
    await ingestTitle(db(), anime(3004, { title: 'Parent A' }));
    await ingestTitle(db(), anime(3005, { title: 'Parent B' }));
    await ingestRelations(db(), 'jikan', 'anime:3004', [rel('sequel', 3201, 'Shared Stub')]);
    await ingestRelations(db(), 'jikan', 'anime:3005', [rel('sequel', 3201, 'Shared Stub')]);

    expect((await ingestRelations(db(), 'jikan', 'anime:3004', [])).stubsRemoved).toBe(0);
    expect(await count(`select count(*) n from public.titles where title = 'Shared Stub'`)).toBe(1);
    expect((await ingestRelations(db(), 'jikan', 'anime:3005', [])).stubsRemoved).toBe(1);
    expect(await count(`select count(*) n from public.titles where title = 'Shared Stub'`)).toBe(0);
  });

  it('never deletes a real title, only stubs', async () => {
    await ingestTitle(db(), anime(3006, { title: 'Real Parent' }));
    const child = await ingestTitle(db(), anime(3007, { title: 'Real Child' }));
    await ingestRelations(db(), 'jikan', 'anime:3006', [rel('sequel', 3007, 'Real Child')]);
    expect(await ingestRelations(db(), 'jikan', 'anime:3006', [])).toEqual({ edges: 0, stubsCreated: 0, stubsRemoved: 0 });
    expect(await count(`select count(*) n from public.titles where id = $1`, [child.titleId])).toBe(1);
  });

  it('refuses to attach edges to a title that was never ingested', async () => {
    await expect(ingestRelations(db(), 'jikan', 'anime:404', [])).rejects.toThrow(/has not been ingested/);
  });
});

describe('jobKey and findResumePage', () => {
  it('names a job by what makes it different', () => {
    expect(jobKey('anime')).toBe('anime');
    expect(jobKey('anime', { order: 'score' })).not.toBe(jobKey('anime', { order: 'newest' }));
    expect(jobKey('books', { subject: 'fantasy', query: 'dune', order: 'popular' })).toBe('books:subject=fantasy:query=dune:order=popular');
    expect(jobKey('anime', { limit: 10 })).toBe('anime'); // page size does not make it a different job
  });

  it('resumes a run that crashed while still marked running, and ignores unknown jobs', async () => {
    await pg.query(`insert into public.ingestion_runs (provider, job, status, cursor) values ('jikan', 'crashed-job', 'running', '{"page": 7}'::jsonb)`);
    expect(await findResumePage(db(), 'jikan', 'crashed-job')).toBe(7);
    expect(await findResumePage(db(), 'jikan', 'never-ran')).toBeUndefined();
    expect(await findResumePage(db(), 'tmdb', 'crashed-job')).toBeUndefined(); // another provider's job
  });
});

describe('runIngestion', () => {
  function adapterFrom(pages: Array<ListPage | Error>, extra: Partial<ProviderAdapter> = {}): ProviderAdapter & { calls: number[] } {
    const calls: number[] = [];
    return {
      id: 'jikan',
      kinds: ['anime'],
      isConfigured: () => ({ ok: true }),
      async listPage(_kind, pageNumber) {
        calls.push(pageNumber);
        const next = pages.shift();
        if (!next) throw new Error('no more scripted pages');
        if (next instanceof Error) throw next;
        return next;
      },
      ...extra,
      calls,
    };
  }
  const page = (n: number, items: NormalizedTitle[], hasNext = true, errors: ListPage['errors'] = []): ListPage => ({
    page: n,
    items,
    errors,
    hasNext,
  });

  it('walks pages, counts outcomes and logs the run', async () => {
    const adapter = adapterFrom([page(1, [anime(1001), anime(1002)]), page(2, [anime(1002), anime(1003)], false)]);
    const summary = await runIngestion({ db: db(), adapter, kind: 'anime', pages: 5 });
    expect(summary).toMatchObject({ status: 'succeeded', seen: 4, inserted: 3, updated: 0, unchanged: 1, failed: 0, nextPage: 3 });
    expect(adapter.calls).toEqual([1, 2]); // stopped because the provider said there is no next page

    const row = (await pg.query<Record<string, unknown>>(`select * from public.ingestion_runs where id = $1`, [summary.runId])).rows[0]!;
    expect(row).toMatchObject({
      provider: 'jikan',
      job: 'anime',
      status: 'succeeded',
      items_seen: 4,
      items_inserted: 3,
      items_unchanged: 1,
      items_failed: 0,
    });
    expect(row.finished_at).not.toBeNull();
  });

  it('stops at the requested number of pages and starts where it is told', async () => {
    const adapter = adapterFrom([page(4, [anime(1010)]), page(5, [anime(1011)]), page(6, [anime(1012)])]);
    const summary = await runIngestion({ db: db(), adapter, kind: 'anime', pages: 2, startPage: 4 });
    expect(adapter.calls).toEqual([4, 5]);
    expect(summary).toMatchObject({ status: 'succeeded', inserted: 2, nextPage: 6 });
  });

  it('records bad items and finishes as partial without losing the good ones', async () => {
    const adapter = adapterFrom([page(1, [anime(1020)], false, [{ externalId: 'anime:77', message: 'title: Required' }])]);
    const summary = await runIngestion({ db: db(), adapter, kind: 'anime', pages: 1 });
    expect(summary).toMatchObject({ status: 'partial', seen: 2, inserted: 1, failed: 1 });
    const errors = await pg.query<{ external_id: string; message: string }>(
      `select external_id, message from public.ingestion_errors where run_id = $1`,
      [summary.runId],
    );
    expect(errors.rows).toEqual([{ external_id: 'anime:77', message: 'title: Required' }]);
  });

  it('records a database failure on one title and carries on with the rest', async () => {
    const flaky = failingDb((_text, params) => params?.includes('Poison Pill') ?? false);
    const adapter = adapterFrom([page(1, [anime(1030), anime(1031, { title: 'Poison Pill' }), anime(1032)], false)]);
    const summary = await runIngestion({ db: flaky, adapter, kind: 'anime', pages: 1 });
    expect(summary).toMatchObject({ status: 'partial', inserted: 2, failed: 1 });
    expect(await count(`select count(*) n from public.title_sources where external_id = 'anime:1031'`)).toBe(0);
    const errors = await pg.query<{ external_id: string; message: string }>(`select external_id, message from public.ingestion_errors where run_id = $1`, [summary.runId]);
    expect(errors.rows).toEqual([{ external_id: 'anime:1031', message: 'injected failure' }]);
  });

  it('fails the run on a page-level error and resumes from that page next time', async () => {
    const options = { order: 'score' } as const;
    const outage = new Error('HTTP 503 (https://api.jikan.moe/v4/anime)');
    const summary = await runIngestion({
      db: db(),
      adapter: adapterFrom([page(1, [anime(1040)]), outage]),
      kind: 'anime',
      pages: 5,
      listOptions: options,
    });
    expect(summary).toMatchObject({ status: 'failed', inserted: 1, nextPage: 2, error: expect.stringContaining('503') });
    const failedRow = (await pg.query<{ status: string; error: string; finished_at: unknown }>(`select status, error, finished_at from public.ingestion_runs where id = $1`, [summary.runId])).rows[0]!;
    expect(failedRow.status).toBe('failed');
    expect(failedRow.error).toContain('503');
    expect(failedRow.finished_at).not.toBeNull();

    const resumeAt = await findResumePage(db(), 'jikan', jobKey('anime', options));
    expect(resumeAt).toBe(2);

    const retry = adapterFrom([page(2, [anime(1041)], false)]);
    const resumed = await runIngestion({ db: db(), adapter: retry, kind: 'anime', pages: 5, listOptions: options, startPage: resumeAt });
    expect(resumed.status).toBe('succeeded');
    expect(retry.calls).toEqual([2]);
    expect(await findResumePage(db(), 'jikan', jobKey('anime', options))).toBeUndefined(); // finished: nothing left to resume
  });

  it('fetches relations only when asked, and records a relations failure without dropping the title', async () => {
    const asked: string[] = [];
    const fetchRelations: ProviderAdapter['fetchRelations'] = async (_kind, externalId) => {
      asked.push(externalId);
      if (externalId === 'anime:1051') throw new Error('HTTP 504');
      return [rel('sequel', 1999, 'Next One')];
    };

    const without = adapterFrom([page(1, [anime(1050)], false)], { fetchRelations });
    await runIngestion({ db: db(), adapter: without, kind: 'anime', pages: 1 });
    expect(asked).toEqual([]);

    const withRelations = adapterFrom([page(1, [anime(1051), anime(1052)], false)], { fetchRelations });
    const summary = await runIngestion({ db: db(), adapter: withRelations, kind: 'anime', pages: 1, withRelations: true });
    expect(asked).toEqual(['anime:1051', 'anime:1052']);
    expect(summary).toMatchObject({ status: 'partial', inserted: 2, failed: 1 });
    expect(await count(`select count(*) n from public.title_relations r join public.title_sources s on s.title_id = r.from_title_id where s.external_id = 'anime:1052'`)).toBe(1);
    expect(await count(`select count(*) n from public.title_relations r join public.title_sources s on s.title_id = r.from_title_id where s.external_id = 'anime:1051'`)).toBe(0);
    const errors = await pg.query<{ message: string }>(`select message from public.ingestion_errors where run_id = $1`, [summary.runId]);
    expect(errors.rows).toEqual([{ message: 'relations: HTTP 504' }]);
  });

  it('refuses to run without credentials or with an unsupported kind, and writes nothing', async () => {
    const runs = await count(`select count(*) n from public.ingestion_runs`);
    const noKey = adapterFrom([], { id: 'tmdb', kinds: ['movie'], isConfigured: () => ({ ok: false, missing: ['TMDB_READ_ACCESS_TOKEN'] }) });
    const err = await runIngestion({ db: db(), adapter: noKey, kind: 'movie', pages: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(MissingCredentialsError);
    expect(err.message).toBe('tmdb is not configured. Missing: TMDB_READ_ACCESS_TOKEN');
    await expect(runIngestion({ db: db(), adapter: adapterFrom([]), kind: 'books', pages: 1 })).rejects.toThrow(/cannot ingest "books"/);
    expect(await count(`select count(*) n from public.ingestion_runs`)).toBe(runs);
  });
});
