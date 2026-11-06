import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTestDb, createUser, rpc, seedTitle } from '../helpers/db';

interface Entry {
  status: string;
  progress: number;
  rating: number | null;
  notes: string | null;
  is_private: boolean;
  started_at: string | null;
  completed_at: string | null;
}

let db: PGlite;
let user: string;
let anime12: string; // 12 episodes
let longRunner: string; // unknown episode count
let manga: string; // 100 chapters
let stub: string;

const asUser = <T>(userId: string, fn: () => Promise<T>) => as(db, { role: 'authenticated', userId }, fn);
const upsert = (args: Record<string, unknown>, who = user) =>
  asUser(who, () => rpc<Entry>(db, 'upsert_library_entry', args));
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  db = await createTestDb();
  user = await createUser(db, 'reader@example.test', 'reader_one');
  anime12 = await seedTitle(db, { slug: 'twelve', title: 'Twelve Episodes', episodes: 12 });
  longRunner = await seedTitle(db, { slug: 'long', title: 'Long Runner', status: 'releasing' });
  manga = await seedTitle(db, { slug: 'manga-100', title: 'Hundred Chapters', media_type: 'manga', chapters: 100 });
  stub = await seedTitle(db, { slug: 'a-stub', title: 'Just A Stub', is_stub: true });
});
afterAll(async () => {
  await db.close();
});

describe('upsert_library_entry', () => {
  it('adds a title as planned by default, with no dates', async () => {
    const e = await upsert({ p_title_id: anime12 });
    expect(e).toMatchObject({ status: 'planned', progress: 0, rating: null, is_private: false });
    expect(e.started_at).toBeNull();
    expect(e.completed_at).toBeNull();
  });

  it('stamps started_at on the first progress and keeps it afterwards', async () => {
    const first = await upsert({ p_title_id: anime12, p_status: 'in_progress', p_progress: 3 });
    expect(first).toMatchObject({ status: 'in_progress', progress: 3, started_at: today() });
    await db.query(`update public.library_entries set started_at = '2020-01-01' where user_id = $1`, [user]);
    const second = await upsert({ p_title_id: anime12, p_progress: 5 });
    expect(second.progress).toBe(5);
    expect(second.started_at).toBe('2020-01-01');
  });

  it('refuses progress beyond the known total', async () => {
    await expect(upsert({ p_title_id: anime12, p_progress: 13 })).rejects.toThrow(/progress_exceeds_total/);
    await expect(upsert({ p_title_id: manga, p_progress: 101 })).rejects.toThrow(/progress_exceeds_total/);
    await expect(upsert({ p_title_id: anime12, p_progress: -1 })).rejects.toThrow(/invalid_progress/);
  });

  it('accepts any progress when the total is unknown', async () => {
    const e = await upsert({ p_title_id: longRunner, p_status: 'in_progress', p_progress: 1200 });
    expect(e).toMatchObject({ status: 'in_progress', progress: 1200 });
  });

  it('marks an entry completed when progress reaches the total', async () => {
    const e = await upsert({ p_title_id: anime12, p_progress: 12 });
    expect(e).toMatchObject({ status: 'completed', progress: 12, completed_at: today() });
  });

  it('sets progress to the total when the user marks a title completed', async () => {
    const e = await upsert({ p_title_id: manga, p_status: 'completed' });
    expect(e).toMatchObject({ status: 'completed', progress: 100, completed_at: today() });
  });

  it('keeps the original completion date on later edits', async () => {
    await db.query(`update public.library_entries set completed_at = '2021-05-05' where user_id = $1 and title_id = $2`, [user, manga]);
    const e = await upsert({ p_title_id: manga, p_status: 'completed', p_rating: 8 });
    expect(e.completed_at).toBe('2021-05-05');
  });

  it('validates, sets and clears ratings', async () => {
    await expect(upsert({ p_title_id: anime12, p_rating: 0 })).rejects.toThrow(/invalid_rating/);
    await expect(upsert({ p_title_id: anime12, p_rating: 11 })).rejects.toThrow(/invalid_rating/);
    expect((await upsert({ p_title_id: anime12, p_rating: 9 })).rating).toBe(9);
    expect((await upsert({ p_title_id: anime12, p_notes: 'rewatch soon' })).rating).toBe(9); // untouched
    expect((await upsert({ p_title_id: anime12, p_clear_rating: true })).rating).toBeNull();
  });

  it('treats notes as patchable text and an empty string as clearing them', async () => {
    expect((await upsert({ p_title_id: anime12, p_notes: '  great ending  ' })).notes).toBe('great ending');
    expect((await upsert({ p_title_id: anime12, p_progress: 12 })).notes).toBe('great ending');
    expect((await upsert({ p_title_id: anime12, p_notes: '' })).notes).toBeNull();
    expect((await upsert({ p_title_id: anime12, p_notes: 'second thought' })).notes).toBe('second thought');
    expect((await upsert({ p_title_id: anime12, p_notes: '\n \t\n' })).notes).toBeNull(); // only whitespace: nothing to keep
  });

  it('holds on to notes of exactly the allowed length and refuses more', async () => {
    expect((await upsert({ p_title_id: anime12, p_notes: 'x'.repeat(2000) })).notes).toHaveLength(2000);
    await expect(upsert({ p_title_id: anime12, p_notes: 'x'.repeat(2001) })).rejects.toThrow(/check constraint/i);
    expect((await upsert({ p_title_id: anime12, p_notes: '' })).notes).toBeNull();
  });

  it('rejects unknown statuses, stub titles and anonymous callers', async () => {
    await expect(upsert({ p_title_id: anime12, p_status: 'binging' })).rejects.toThrow(/invalid_status/);
    await expect(upsert({ p_title_id: stub, p_status: 'planned' })).rejects.toThrow(/title_not_found/);
    await expect(
      as(db, { role: 'anon' }, () => rpc(db, 'upsert_library_entry', { p_title_id: anime12 })),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('library listing and removal', () => {
  it('lists entries with progress units and totals, and counts by status', async () => {
    const lib = await asUser(user, () =>
      rpc<{
        total: number;
        counts: Record<string, number>;
        items: { title: { slug: string }; progress_unit: string; progress_total: number | null }[];
      }>(db, 'list_library', {}),
    );
    expect(lib.total).toBe(3);
    expect(lib.counts).toEqual({ completed: 2, in_progress: 1 });
    const bySlug = Object.fromEntries(lib.items.map((i) => [i.title.slug, i]));
    expect(bySlug['twelve']).toMatchObject({ progress_unit: 'episodes', progress_total: 12 });
    expect(bySlug['manga-100']).toMatchObject({ progress_unit: 'chapters', progress_total: 100 });
    expect(bySlug['long']).toMatchObject({ progress_unit: 'episodes', progress_total: null });

    const onlyDone = await asUser(user, () => rpc<{ total: number }>(db, 'list_library', { p_status: 'completed' }));
    expect(onlyDone.total).toBe(2);
  });

  it('returns the caller\'s own entry through get_library_entry', async () => {
    const mine = await asUser(user, () => rpc<Entry | null>(db, 'get_library_entry', { p_title_id: anime12 }));
    expect(mine?.status).toBe('completed');
    const other = await createUser(db, 'someone@example.test');
    expect(await asUser(other, () => rpc(db, 'get_library_entry', { p_title_id: anime12 }))).toBeNull();
  });

  it('removes an entry and reports whether anything was removed', async () => {
    expect(await asUser(user, () => rpc<boolean>(db, 'remove_library_entry', { p_title_id: longRunner }))).toBe(true);
    expect(await asUser(user, () => rpc<boolean>(db, 'remove_library_entry', { p_title_id: longRunner }))).toBe(false);
  });

  it('takes the notes with an entry when it is removed', async () => {
    await upsert({ p_title_id: longRunner, p_notes: 'will not outlive the entry' });
    expect((await db.query(`select 1 from public.library_notes where user_id = $1 and title_id = $2`, [user, longRunner])).rows).toHaveLength(1);
    await asUser(user, () => rpc(db, 'remove_library_entry', { p_title_id: longRunner }));
    expect((await db.query(`select 1 from public.library_notes where user_id = $1 and title_id = $2`, [user, longRunner])).rows).toHaveLength(0);
  });

  it('pages through entries that share a timestamp in a fixed order, so none repeat or go missing', async () => {
    const pager = await createUser(db, 'pager@example.test', 'pager_one');
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const id = await seedTitle(db, { slug: `tie-${i}`, title: `Tie ${i}`, episodes: 12 });
      ids.push(id);
      await db.query(
        `insert into public.library_entries (user_id, title_id, status, updated_at) values ($1, $2, 'planned', '2024-01-01T00:00:00Z')`,
        [pager, id],
      );
    }
    const slugs: string[] = [];
    for (const offset of [0, 2, 4]) {
      const page = await asUser(pager, () =>
        rpc<{ items: { title: { id: string } }[] }>(db, 'list_library', { p_limit: 2, p_offset: offset }),
      );
      slugs.push(...page.items.map((i) => i.title.id));
    }
    expect(slugs).toEqual([...ids].sort()); // equal timestamps fall back to the title id
  });
});

describe('community rating summary and relations on get_title', () => {
  it('aggregates ratings from all users and pulls small samples toward the prior', async () => {
    const target = await seedTitle(db, { slug: 'rated', title: 'Rated Title', episodes: 10 });
    const ratings = [10, 10, 8];
    for (const [i, r] of ratings.entries()) {
      const u = await createUser(db, `rater${i}@example.test`);
      await asUser(u, () => rpc(db, 'upsert_library_entry', { p_title_id: target, p_status: 'completed', p_rating: r, p_is_private: i === 2 }));
    }
    const page = await as(db, { role: 'anon' }, () =>
      rpc<{ community: { count: number; average: number; bayesian: number; distribution: Record<string, number> } }>(db, 'get_title', { p_slug: 'rated' }),
    );
    expect(page.community.count).toBe(3); // private entries count toward the aggregate, never individually exposed
    expect(page.community.average).toBeCloseTo(9.33, 2);
    expect(page.community.distribution).toEqual({ '8': 1, '10': 2 });
    // (10 * 7.0 + 28) / (10 + 3) = 7.54: three votes barely move the prior
    expect(page.community.bayesian).toBeCloseTo(7.54, 2);
  });

  it('shows relations from both sides with inverse labels, and hides stubs from direct lookup', async () => {
    const a = await seedTitle(db, { slug: 'saga-1', title: 'Saga One' });
    const b = await seedTitle(db, { slug: 'saga-2', title: 'Saga Two' });
    const novel = await seedTitle(db, { slug: 'saga-novel', title: 'Saga Novel', media_type: 'novel' });
    await db.query(
      `insert into public.title_relations (from_title_id, to_title_id, relation, source) values
         ($1, $2, 'sequel', 'test'), ($2, $1, 'prequel', 'test'), ($1, $3, 'adapted_from', 'test')`,
      [a, b, novel],
    );
    type Page = { relations: { relation: string; title: { slug: string; id: string } }[] };
    const pageB = await as(db, { role: 'anon' }, () => rpc<Page>(db, 'get_title', { p_slug: 'saga-2' }));
    expect(pageB.relations.map((r) => [r.relation, r.title.slug])).toEqual([['prequel', 'saga-1']]); // deduplicated
    const pageA = await as(db, { role: 'anon' }, () => rpc<Page>(db, 'get_title', { p_slug: 'saga-1' }));
    expect(pageA.relations.map((r) => [r.relation, r.title.slug])).toEqual([
      ['sequel', 'saga-2'],
      ['adapted_from', 'saga-novel'],
    ]);
    const pageN = await as(db, { role: 'anon' }, () => rpc<Page>(db, 'get_title', { p_slug: 'saga-novel' }));
    expect(pageN.relations.map((r) => [r.relation, r.title.slug])).toEqual([['adapted_into', 'saga-1']]);

    expect(await as(db, { role: 'anon' }, () => rpc(db, 'get_title', { p_slug: 'a-stub' }))).toBeNull();
    expect(await as(db, { role: 'anon' }, () => rpc(db, 'get_title', { p_slug: 'does-not-exist' }))).toBeNull();
  });
});
