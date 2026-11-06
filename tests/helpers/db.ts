import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import type { Db, Queryable } from '@/lib/ingest/db';

const ROOT = process.cwd();

export function migrationFiles(): string[] {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(dir, f));
}

/** A fresh in-process Postgres with the Supabase shim and every migration applied. */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.waitReady;
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'tests', 'shim.sql'), 'utf8'));
  for (const file of migrationFiles()) {
    try {
      await db.exec(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`Migration ${path.basename(file)} failed: ${(err as Error).message}`);
    }
  }
  return db;
}

type Actor = { role: 'anon' } | { role: 'authenticated'; userId: string } | { role: 'service_role' };

/**
 * Run `fn` the way PostgREST would: with a database role and JWT claims set.
 * Always restores the superuser session afterwards, even when `fn` throws.
 */
export async function as<T>(db: PGlite, actor: Actor, fn: () => Promise<T>): Promise<T> {
  const claims =
    actor.role === 'authenticated'
      ? { sub: actor.userId, role: 'authenticated' }
      : { role: actor.role };
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await db.exec(`set role ${actor.role}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

/** Call a SQL function that returns jsonb and give back the parsed value. */
export async function rpc<T = unknown>(
  db: PGlite,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const names = Object.keys(args);
  const placeholders = names.map((n, i) => `${n} => $${i + 1}`).join(', ');
  const res = await db.query<{ result: T }>(
    `select public.${fn}(${placeholders}) as result`,
    names.map((n) => args[n]),
  );
  return res.rows[0]!.result;
}

export async function createUser(
  db: PGlite,
  email: string,
  username?: string,
): Promise<string> {
  const meta = username ? { username } : {};
  const res = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
    [email, JSON.stringify(meta)],
  );
  return res.rows[0]!.id;
}

export interface SeedTitle {
  id?: string;
  slug: string;
  title: string;
  media_type?: string;
  title_original?: string | null;
  synopsis?: string | null;
  status?: string;
  release_year?: number | null;
  episodes?: number | null;
  chapters?: number | null;
  pages?: number | null;
  genres?: string[];
  themes?: string[];
  provider_score?: number | null;
  provider_score_count?: number | null;
  popularity?: number | null;
  is_stub?: boolean;
  alt_names?: string[];
}

/** Insert a catalog row directly (as the database owner) for tests. */
export async function seedTitle(db: PGlite, t: SeedTitle): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into public.titles
       (slug, title, media_type, title_original, synopsis, status, release_year, episodes, chapters, pages,
        genres, themes, provider_score, provider_score_count, popularity, is_stub)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text[],$12::text[],$13,$14,$15,$16)
     returning id`,
    [
      t.slug,
      t.title,
      t.media_type ?? 'anime',
      t.title_original ?? null,
      t.synopsis ?? null,
      t.status ?? 'finished',
      t.release_year ?? null,
      t.episodes ?? null,
      t.chapters ?? null,
      t.pages ?? null,
      t.genres ?? [],
      t.themes ?? [],
      t.provider_score ?? null,
      t.provider_score_count ?? null,
      t.popularity ?? null,
      t.is_stub ?? false,
    ],
  );
  const id = res.rows[0]!.id;
  for (const name of t.alt_names ?? []) {
    await db.query(`insert into public.title_alt_names (title_id, name) values ($1, $2)`, [id, name]);
  }
  return id;
}

/** Adapt a PGlite instance to the ingestion pipeline's Db interface. */
export function pgliteDb(db: PGlite): Db {
  const wrap = (q: { query: PGlite['query'] }): Queryable => ({
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      const res = await q.query<T>(text, params as unknown[] | undefined);
      return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
    },
  });
  return {
    ...wrap(db),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => fn(wrap(tx as unknown as { query: PGlite['query'] })));
    },
    async close() {
      /* the test owns the PGlite lifecycle */
    },
  };
}
