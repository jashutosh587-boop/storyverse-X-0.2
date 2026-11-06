import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTestDb, createUser, seedTitle } from '../helpers/db';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

describe('migrations', () => {
  it('apply cleanly in order and create the expected tables', async () => {
    const res = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    const names = res.rows.map((r) => r.table_name);
    for (const t of [
      'titles',
      'title_alt_names',
      'title_sources',
      'title_relations',
      'contributors',
      'contributor_sources',
      'title_contributors',
      'profiles',
      'library_entries',
      'library_notes',
      'ingestion_runs',
      'ingestion_errors',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('enables Row Level Security on every table in the public schema', async () => {
    const res = await db.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(res.rows.map((r) => r.relname)).toEqual([]);
  });

  it('pins search_path on every SECURITY DEFINER function', async () => {
    const res = await db.query<{ proname: string; proconfig: string[] | null }>(
      `select p.proname, p.proconfig
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef`,
    );
    expect(res.rows.length).toBeGreaterThan(0);
    for (const fn of res.rows) {
      expect(fn.proconfig?.some((c) => c.startsWith('search_path=')), fn.proname).toBe(true);
    }
  });
});

describe('catalog permissions', () => {
  it('lets anyone read titles', async () => {
    await seedTitle(db, { slug: 'readable-1', title: 'Readable' });
    const rows = await as(db, { role: 'anon' }, () =>
      db.query(`select slug from public.titles where slug = 'readable-1'`),
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('refuses catalog writes from anonymous and signed-in visitors', async () => {
    const userId = await createUser(db, 'writer@example.test');
    const insert = `insert into public.titles (slug, title, media_type) values ('hacked', 'Hacked', 'anime')`;
    await expect(as(db, { role: 'anon' }, () => db.exec(insert))).rejects.toThrow(/permission denied/i);
    await expect(
      as(db, { role: 'authenticated', userId }, () => db.exec(insert)),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      as(db, { role: 'authenticated', userId }, () =>
        db.exec(`update public.titles set title = 'Hacked' where slug = 'readable-1'`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('keeps ingestion tables and the duplicate report away from visitors', async () => {
    const userId = await createUser(db, 'snoop@example.test');
    for (const sql of [
      'select * from public.ingestion_runs',
      'select * from public.ingestion_errors',
      'select * from public.duplicate_title_candidates',
    ]) {
      await expect(as(db, { role: 'anon' }, () => db.exec(sql))).rejects.toThrow(/permission denied/i);
      await expect(
        as(db, { role: 'authenticated', userId }, () => db.exec(sql)),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('rejects invalid catalog values at the database', async () => {
    await expect(
      db.exec(`insert into public.titles (slug, title, media_type) values ('bad-type', 'Bad', 'podcast')`),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.exec(
        `insert into public.titles (slug, title, media_type, provider_score) values ('bad-score', 'Bad', 'anime', 11)`,
      ),
    ).rejects.toThrow(/check constraint|numeric field overflow/i);
    await expect(
      db.exec(`insert into public.titles (slug, title, media_type) values ('blank', '   ', 'anime')`),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe('duplicate candidates', () => {
  it('flags visible titles with the same name, type and year, and ignores stubs', async () => {
    await seedTitle(db, { slug: 'dup-a', title: 'Same Name', release_year: 2001 });
    await seedTitle(db, { slug: 'dup-b', title: 'same name', release_year: 2001 });
    await seedTitle(db, { slug: 'dup-c', title: 'Same Name', release_year: 2001, is_stub: true });
    await seedTitle(db, { slug: 'dup-d', title: 'Same Name', release_year: 2010 });
    const res = await db.query(`select * from public.duplicate_title_candidates where lower(title) = 'same name'`);
    expect(res.rows).toHaveLength(1);
  });
});
