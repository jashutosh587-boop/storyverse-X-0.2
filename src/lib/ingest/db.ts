import fs from 'node:fs';
import { Pool, type QueryResultRow } from 'pg';

/**
 * The minimal database surface the ingestion pipeline needs. Production uses
 * `pg`; tests use an in-process Postgres (PGlite) behind the same interface.
 */
export interface QueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** TLS settings for a connection string. Local databases get none. */
export function sslFor(connectionString: string, env: Record<string, string | undefined> = process.env) {
  const host = new URL(connectionString).hostname;
  if (['localhost', '127.0.0.1', '::1'].includes(host)) return undefined;
  if (env.DATABASE_SSL_CA) {
    return { ca: fs.readFileSync(env.DATABASE_SSL_CA, 'utf8'), rejectUnauthorized: true };
  }
  if (env.DATABASE_SSL_INSECURE === '1') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

export function pgDb(connectionString: string): Db {
  // pg lets sslmode in the URL override the ssl option, so strip it and decide ourselves.
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');

  const pool = new Pool({
    connectionString: url.toString(),
    max: 4,
    ssl: sslFor(connectionString),
  });

  const run = <T>(
    q: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> },
    text: string,
    params?: unknown[],
  ) => q.query(text, params) as Promise<QueryResult<T>>;

  return {
    query: (text, params) => run(pool, text, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({
          query: <T = Record<string, unknown>>(text: string, params?: unknown[]) =>
            run<T>(client as unknown as Parameters<typeof run>[0], text, params),
        });
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export type { QueryResultRow };
