import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTestDb, createUser, rpc, seedTitle } from '../helpers/db';

let db: PGlite;
let alice: string;
let bob: string;
let animeId: string;
let mangaId: string;

const anon = <T>(fn: () => Promise<T>) => as(db, { role: 'anon' }, fn);
const asUser = <T>(userId: string, fn: () => Promise<T>) => as(db, { role: 'authenticated', userId }, fn);

beforeAll(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.test', 'alice_a');
  bob = await createUser(db, 'bob@example.test', 'bob_b');
  animeId = await seedTitle(db, { slug: 'one', title: 'One', media_type: 'anime', episodes: 12 });
  await seedTitle(db, { slug: 'two', title: 'Two', media_type: 'anime' });
  mangaId = await seedTitle(db, { slug: 'three', title: 'Three', media_type: 'manga', chapters: 10 });
  await seedTitle(db, { slug: 'placeholder', title: 'Placeholder', media_type: 'novel', is_stub: true });
});
afterAll(async () => {
  await db.close();
});

describe('catalog_stats', () => {
  it('counts real titles per medium and ignores stubs', async () => {
    const stats = await anon(() => rpc<{ total: number; by_type: Record<string, number> }>(db, 'catalog_stats'));
    expect(stats).toEqual({ total: 3, by_type: { anime: 2, manga: 1 } });
  });

  it('is empty, not an error, on an empty catalog', async () => {
    const empty = await createTestDb();
    try {
      const stats = await as(empty, { role: 'anon' }, () => rpc(empty, 'catalog_stats'));
      expect(stats).toEqual({ total: 0, by_type: {} });
    } finally {
      await empty.close();
    }
  });
});

describe('catalog_attributions', () => {
  it('lists each provider that supplied a visible title, once, with its credit text', async () => {
    const one = await db.query<{ id: string }>(`select id from public.titles where slug = 'one'`);
    const two = await db.query<{ id: string }>(`select id from public.titles where slug = 'two'`);
    const stub = await db.query<{ id: string }>(`select id from public.titles where slug = 'placeholder'`);
    const add = (titleId: string, provider: string, externalId: string, attribution: string) =>
      db.query(
        `insert into public.title_sources (provider, external_id, title_id, attribution) values ($1, $2, $3, $4)`,
        [provider, externalId, titleId, attribution],
      );
    await add(one.rows[0]!.id, 'jikan', 'anime:1', 'From MyAnimeList via Jikan.');
    await add(two.rows[0]!.id, 'jikan', 'anime:2', 'From MyAnimeList via Jikan.');
    await add(mangaId, 'tmdb', 'movie:1', 'From TMDB.');
    await add(stub.rows[0]!.id, 'openlibrary', 'OL1W', 'From Open Library.'); // only a stub: must not be credited

    const list = await anon(() =>
      rpc<{ provider: string; titles: number; attribution: string; last_fetched_at: string }[]>(db, 'catalog_attributions'),
    );
    expect(list.map((p) => [p.provider, p.titles, p.attribution])).toEqual([
      ['jikan', 2, 'From MyAnimeList via Jikan.'],
      ['tmdb', 1, 'From TMDB.'],
    ]);
    expect(Date.parse(list[0]!.last_fetched_at)).not.toBeNaN();
  });
});

describe('delete_my_account', () => {
  it('removes the account, profile and library, and nothing belonging to anyone else', async () => {
    await asUser(alice, () => rpc(db, 'upsert_library_entry', { p_title_id: animeId, p_status: 'completed', p_rating: 9 }));
    await asUser(bob, () => rpc(db, 'upsert_library_entry', { p_title_id: animeId, p_status: 'completed', p_rating: 5 }));
    const before = await anon(() => rpc<{ community: { count: number } }>(db, 'get_title', { p_slug: 'one' }));
    expect(before.community.count).toBe(2);

    await asUser(alice, () => rpc(db, 'delete_my_account'));

    const count = async (sql: string, params: unknown[]) =>
      Number((await db.query<{ n: number | string }>(sql, params)).rows[0]!.n);
    expect(await count(`select count(*) n from auth.users where id = $1`, [alice])).toBe(0);
    expect(await count(`select count(*) n from public.profiles where id = $1`, [alice])).toBe(0);
    expect(await count(`select count(*) n from public.library_entries where user_id = $1`, [alice])).toBe(0);

    // bob and his entry are untouched, and the community count drops by the deleted rating
    expect(await count(`select count(*) n from auth.users where id = $1`, [bob])).toBe(1);
    expect(await count(`select count(*) n from public.library_entries where user_id = $1`, [bob])).toBe(1);
    const after = await anon(() => rpc<{ community: { count: number; average: number } }>(db, 'get_title', { p_slug: 'one' }));
    expect(after.community).toMatchObject({ count: 1, average: 5 });
  });

  it('cannot be called by a visitor who is not signed in', async () => {
    await expect(anon(() => rpc(db, 'delete_my_account'))).rejects.toThrow(/permission denied/);
    expect(Number((await db.query<{ n: number | string }>(`select count(*) n from auth.users`)).rows[0]!.n)).toBe(1);
  });

  it('refuses a signed-in role whose token carries no user', async () => {
    await db.query(`select set_config('request.jwt.claims', '{"role":"authenticated"}', false)`);
    await db.exec('set role authenticated');
    try {
      await expect(rpc(db, 'delete_my_account')).rejects.toThrow(/not_authenticated/);
    } finally {
      await db.exec('reset role');
      await db.query(`select set_config('request.jwt.claims', '', false)`);
    }
    expect(Number((await db.query<{ n: number | string }>(`select count(*) n from auth.users`)).rows[0]!.n)).toBe(1);
  });
});
