import type { ListOptions, ProviderAdapter } from '../providers/types';
import type { Db } from './db';
import { ingestRelations, ingestTitle } from './ingest';

export class MissingCredentialsError extends Error {
  constructor(
    readonly provider: string,
    readonly missing: string[],
  ) {
    super(`${provider} is not configured. Missing: ${missing.join(', ')}`);
    this.name = 'MissingCredentialsError';
  }
}

export interface RunOptions {
  db: Db;
  adapter: ProviderAdapter;
  kind: string;
  listOptions?: ListOptions;
  /** First page to fetch (default 1). */
  startPage?: number;
  /** How many pages to fetch at most. */
  pages: number;
  /** Also fetch and store relationship edges (one extra request per title). */
  withRelations?: boolean;
  log?: (message: string) => void;
}

export interface RunSummary {
  runId: string;
  status: 'succeeded' | 'partial' | 'failed';
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  failed: number;
  /** The next page to fetch to continue this job. */
  nextPage: number;
  error?: string;
}

/** A stable name for "the same job", used to find a run to resume. */
export function jobKey(kind: string, options: ListOptions = {}): string {
  const parts = [kind];
  if (options.subject) parts.push(`subject=${options.subject}`);
  if (options.query) parts.push(`query=${options.query}`);
  if (options.order) parts.push(`order=${options.order}`);
  return parts.join(':');
}

/**
 * Where an interrupted job should continue. Only a run that stopped early
 * ('failed', or still marked 'running' after a crash) can be resumed; a run that
 * reached the end of the provider's results has nothing left to fetch.
 */
export async function findResumePage(db: Db, provider: string, job: string): Promise<number | undefined> {
  const res = await db.query<{ status: string; cursor: { page?: number } | null }>(
    `select status, cursor from public.ingestion_runs
      where provider = $1 and job = $2
      order by started_at desc limit 1`,
    [provider, job],
  );
  const last = res.rows[0];
  return last && (last.status === 'failed' || last.status === 'running') ? last.cursor?.page : undefined;
}

export async function runIngestion(opts: RunOptions): Promise<RunSummary> {
  const { db, adapter, kind, listOptions = {}, pages, withRelations = false, log = () => undefined } = opts;

  const config = adapter.isConfigured();
  if (!config.ok) throw new MissingCredentialsError(adapter.id, config.missing);
  if (!adapter.kinds.includes(kind)) {
    throw new Error(`${adapter.id} cannot ingest "${kind}". Supported: ${adapter.kinds.join(', ')}`);
  }

  const job = jobKey(kind, listOptions);
  const startPage = opts.startPage ?? 1;
  const run = await db.query<{ id: string }>(
    `insert into public.ingestion_runs (provider, job, params, cursor)
     values ($1, $2, $3::jsonb, $4::jsonb) returning id`,
    [adapter.id, job, JSON.stringify({ kind, listOptions, startPage, pages, withRelations }), JSON.stringify({ page: startPage })],
  );
  const runId = run.rows[0]!.id;

  const counts = { seen: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0 };
  let page = startPage;
  let error: string | undefined;

  const recordError = async (externalId: string | undefined, message: string) => {
    counts.failed++;
    log(`  ! ${externalId ?? '?'}: ${message}`);
    await db.query(`insert into public.ingestion_errors (run_id, external_id, message) values ($1, $2, $3)`, [
      runId,
      externalId ?? null,
      message.slice(0, 2000),
    ]);
  };

  const save = (status: string, finished: boolean) =>
    db.query(
      `update public.ingestion_runs set status = $2, items_seen = $3, items_inserted = $4, items_updated = $5,
         items_unchanged = $6, items_failed = $7, cursor = $8::jsonb, error = $9,
         finished_at = case when $10::boolean then now() else null end
       where id = $1`,
      [runId, status, counts.seen, counts.inserted, counts.updated, counts.unchanged, counts.failed, JSON.stringify({ page }), error ?? null, finished],
    );

  try {
    for (let n = 0; n < pages; n++) {
      log(`${adapter.id} ${kind} page ${page}`);
      const result = await adapter.listPage(kind, page, listOptions);

      for (const bad of result.errors) {
        counts.seen++;
        await recordError(bad.externalId, bad.message);
      }

      for (const item of result.items) {
        counts.seen++;
        try {
          const saved = await ingestTitle(db, item);
          counts[saved.action]++;
          if (withRelations && adapter.fetchRelations) {
            try {
              const relations = await adapter.fetchRelations(kind, item.externalId);
              await ingestRelations(db, item.provider, item.externalId, relations);
            } catch (err) {
              await recordError(item.externalId, `relations: ${(err as Error).message}`);
            }
          }
        } catch (err) {
          await recordError(item.externalId, (err as Error).message);
        }
      }

      page++;
      await save('running', false); // checkpoint: a crash after this point resumes at the next page
      if (!result.hasNext) break;
    }
  } catch (err) {
    // A page-level failure (rate limit never cleared, provider down). Keep the
    // cursor on the page that failed so the job can resume there.
    error = (err as Error).message;
    await save('failed', true);
    return { runId, status: 'failed', ...counts, nextPage: page, error };
  }

  const status = counts.failed === 0 ? 'succeeded' : 'partial';
  await save(status, true);
  return { runId, status, ...counts, nextPage: page };
}
