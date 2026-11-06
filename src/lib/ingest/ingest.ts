import { normalizedTitleSchema, type NormalizedContributor, type NormalizedRelation, type NormalizedTitle, type ProviderId } from '../providers/types';
import { stableSlug } from '../providers/util';
import type { Db, Queryable } from './db';

export type IngestAction = 'inserted' | 'updated' | 'unchanged';
export interface IngestResult {
  titleId: string;
  action: IngestAction;
}

/** Slug lengths to try, in order, if two different records ever collide. */
const SLUG_HASH_LENGTHS = [6, 10, 16];

// Every column the provider is the source of truth for. One list drives both
// the INSERT and the UPDATE, so they cannot drift apart.
const COLUMNS: ReadonlyArray<{ name: string; cast?: string; value: (t: NormalizedTitle) => unknown }> = [
  { name: 'media_type', value: (t) => t.mediaType },
  { name: 'format', value: (t) => t.format ?? null },
  { name: 'title', value: (t) => t.title },
  { name: 'title_original', value: (t) => t.titleOriginal ?? null },
  { name: 'synopsis', value: (t) => t.synopsis ?? null },
  { name: 'status', value: (t) => t.status },
  { name: 'release_date', cast: 'date', value: (t) => t.releaseDate ?? null },
  { name: 'end_date', cast: 'date', value: (t) => t.endDate ?? null },
  { name: 'release_year', cast: 'smallint', value: (t) => t.releaseYear ?? null },
  { name: 'season', value: (t) => t.season ?? null },
  { name: 'season_year', cast: 'smallint', value: (t) => t.seasonYear ?? null },
  { name: 'country', value: (t) => t.country ?? null },
  { name: 'language', value: (t) => t.language ?? null },
  { name: 'episodes', cast: 'integer', value: (t) => t.episodes ?? null },
  { name: 'runtime_minutes', cast: 'integer', value: (t) => t.runtimeMinutes ?? null },
  { name: 'pages', cast: 'integer', value: (t) => t.pages ?? null },
  { name: 'volumes', cast: 'integer', value: (t) => t.volumes ?? null },
  { name: 'chapters', cast: 'integer', value: (t) => t.chapters ?? null },
  { name: 'age_rating', value: (t) => t.ageRating ?? null },
  { name: 'genres', cast: 'text[]', value: (t) => t.genres },
  { name: 'themes', cast: 'text[]', value: (t) => t.themes },
  { name: 'poster_url', value: (t) => t.posterUrl ?? null },
  { name: 'backdrop_url', value: (t) => t.backdropUrl ?? null },
  { name: 'provider_score', cast: 'numeric', value: (t) => t.providerScore ?? null },
  { name: 'provider_score_count', cast: 'integer', value: (t) => t.providerScoreCount ?? null },
  { name: 'provider_score_source', value: (t) => t.providerScoreSource ?? null },
  { name: 'popularity', cast: 'real', value: (t) => t.popularity ?? null },
];

const ph = (index: number, cast?: string) => `$${index}${cast ? `::${cast}` : ''}`;

const recordKey = (provider: string, externalId: string) => `${provider}:${externalId}`;

/**
 * Serialize work on one provider record until the transaction ends. Without
 * this, two overlapping runs (a scheduled job and a manual one) could both see
 * "not ingested yet", both insert, and leave a duplicate title behind.
 */
async function lockRecord(q: Queryable, key: string): Promise<void> {
  await q.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]);
}

async function insertTitle(q: Queryable, t: NormalizedTitle): Promise<string> {
  const names = ['slug', ...COLUMNS.map((c) => c.name), 'is_stub'];
  for (const len of SLUG_HASH_LENGTHS) {
    const slug = stableSlug(t.title, t.provider, t.externalId, len);
    const values = COLUMNS.map((c, i) => ph(i + 2, c.cast));
    const res = await q.query<{ id: string }>(
      `insert into public.titles (${names.join(', ')})
       values ($1, ${values.join(', ')}, false)
       on conflict (slug) do nothing
       returning id`,
      [slug, ...COLUMNS.map((c) => c.value(t))],
    );
    if (res.rows[0]) return res.rows[0].id;
  }
  throw new Error(`Could not allocate a unique slug for ${t.provider}:${t.externalId}`);
}

async function updateTitle(q: Queryable, id: string, t: NormalizedTitle): Promise<void> {
  const sets = COLUMNS.map((c, i) => `${c.name} = ${ph(i + 2, c.cast)}`);
  await q.query(`update public.titles set ${sets.join(', ')}, is_stub = false where id = $1`, [
    id,
    ...COLUMNS.map((c) => c.value(t)),
  ]);
}

async function replaceAltNames(q: Queryable, titleId: string, t: NormalizedTitle): Promise<void> {
  await q.query(`delete from public.title_alt_names where title_id = $1`, [titleId]);
  for (const alt of t.altNames) {
    await q.query(
      `insert into public.title_alt_names (title_id, name, lang, kind) values ($1, $2, $3, $4)
       on conflict (title_id, name) do nothing`,
      [titleId, alt.name, alt.lang ?? null, alt.kind],
    );
  }
}

async function upsertContributor(q: Queryable, c: NormalizedContributor): Promise<string> {
  const found = await q.query<{ contributor_id: string }>(
    `select contributor_id from public.contributor_sources where provider = $1 and external_id = $2`,
    [c.provider, c.externalId],
  );
  if (found.rows[0]) {
    const id = found.rows[0].contributor_id;
    // Only the name follows the provider. The kind is fixed when the contributor
    // is first created: the same company can be credited as studio on one title
    // and producer on another, and the kind must not flip with ingest order
    // (the credit's role is stored on the title, not here).
    await q.query(`update public.contributors set name = $2 where id = $1`, [id, c.name]);
    return id;
  }
  for (const len of SLUG_HASH_LENGTHS) {
    const res = await q.query<{ id: string }>(
      `insert into public.contributors (kind, slug, name) values ($1, $2, $3)
       on conflict (slug) do nothing returning id`,
      [c.kind, stableSlug(c.name, c.provider, c.externalId, len), c.name],
    );
    if (res.rows[0]) {
      await q.query(
        `insert into public.contributor_sources (provider, external_id, contributor_id) values ($1, $2, $3)`,
        [c.provider, c.externalId, res.rows[0].id],
      );
      return res.rows[0].id;
    }
  }
  throw new Error(`Could not allocate a unique slug for contributor ${c.provider}:${c.externalId}`);
}

async function replaceContributors(q: Queryable, titleId: string, t: NormalizedTitle): Promise<void> {
  // Only the credits this provider asserted are replaced; other sources' credits stay.
  await q.query(`delete from public.title_contributors where title_id = $1 and source = $2`, [titleId, t.provider]);
  for (const c of t.contributors) {
    const contributorId = await upsertContributor(q, c);
    await q.query(
      `insert into public.title_contributors (title_id, contributor_id, role, billing_order, source)
       values ($1, $2, $3, $4, $5) on conflict (title_id, contributor_id, role) do nothing`,
      [titleId, contributorId, c.role, c.order ?? null, t.provider],
    );
  }
}

async function upsertSource(q: Queryable, titleId: string, t: NormalizedTitle): Promise<void> {
  await q.query(
    `insert into public.title_sources (provider, external_id, title_id, url, attribution, payload_hash, fetched_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (provider, external_id) do update set
       title_id = excluded.title_id, url = excluded.url, attribution = excluded.attribution,
       payload_hash = excluded.payload_hash, fetched_at = now()`,
    [t.provider, t.externalId, titleId, t.sourceUrl ?? null, t.attribution, t.payloadHash],
  );
}

/**
 * Store one normalized title. Idempotent: the same provider record always maps
 * to the same row, and an unchanged payload is not rewritten. Runs in a single
 * transaction, so a failure leaves nothing half-written.
 */
export async function ingestTitle(db: Db, input: NormalizedTitle): Promise<IngestResult> {
  const t = normalizedTitleSchema.parse(input); // never trust a caller to have validated

  return db.transaction(async (q) => {
    await lockRecord(q, recordKey(t.provider, t.externalId));
    const existing = await q.query<{ title_id: string; payload_hash: string | null; is_stub: boolean }>(
      `select s.title_id, s.payload_hash, ti.is_stub
         from public.title_sources s
         join public.titles ti on ti.id = s.title_id
        where s.provider = $1 and s.external_id = $2`,
      [t.provider, t.externalId],
    );
    const found = existing.rows[0];

    if (found && !found.is_stub && found.payload_hash === t.payloadHash) {
      await q.query(`update public.title_sources set fetched_at = now() where provider = $1 and external_id = $2`, [
        t.provider,
        t.externalId,
      ]);
      return { titleId: found.title_id, action: 'unchanged' as const };
    }

    let titleId: string;
    if (found) {
      titleId = found.title_id;
      await updateTitle(q, titleId, t);
    } else {
      titleId = await insertTitle(q, t);
    }
    await replaceAltNames(q, titleId, t);
    await replaceContributors(q, titleId, t);
    await upsertSource(q, titleId, t);
    return { titleId, action: found ? ('updated' as const) : ('inserted' as const) };
  });
}

export interface RelationsResult {
  /** Edges stored for this title. */
  edges: number;
  /** Placeholder titles created for related works that are not in the catalog yet. */
  stubsCreated: number;
  /** Placeholders removed because the provider no longer relates anything to them. */
  stubsRemoved: number;
}

/**
 * Replace the edges one provider asserts for a title. Targets that have not
 * been ingested yet become hidden stub titles, so the graph keeps its shape and
 * the stub is filled in when the target is ingested later. A stub that loses
 * its last edge is removed again, so dropped relations leave nothing behind.
 */
export async function ingestRelations(
  db: Db,
  fromProvider: ProviderId,
  fromExternalId: string,
  relations: NormalizedRelation[],
): Promise<RelationsResult> {
  return db.transaction(async (q) => {
    // Lock every record this call may create, in a fixed order so two runs cannot deadlock.
    const keys = new Set(relations.map((r) => recordKey(r.target.provider, r.target.externalId)));
    for (const key of [...keys].sort()) await lockRecord(q, key);

    const from = await q.query<{ title_id: string }>(
      `select title_id from public.title_sources where provider = $1 and external_id = $2`,
      [fromProvider, fromExternalId],
    );
    const fromId = from.rows[0]?.title_id;
    if (!fromId) {
      throw new Error(`Cannot add relations: ${fromProvider}:${fromExternalId} has not been ingested`);
    }

    const previous = await q.query<{ to_title_id: string }>(
      `select to_title_id from public.title_relations where from_title_id = $1 and source = $2`,
      [fromId, fromProvider],
    );
    await q.query(`delete from public.title_relations where from_title_id = $1 and source = $2`, [fromId, fromProvider]);

    let edges = 0;
    let stubsCreated = 0;
    for (const r of relations) {
      const target = await q.query<{ title_id: string }>(
        `select title_id from public.title_sources where provider = $1 and external_id = $2`,
        [r.target.provider, r.target.externalId],
      );
      let toId = target.rows[0]?.title_id;

      if (!toId) {
        for (const len of SLUG_HASH_LENGTHS) {
          const stub = await q.query<{ id: string }>(
            `insert into public.titles (slug, title, media_type, status, is_stub)
             values ($1, $2, $3, 'unknown', true) on conflict (slug) do nothing returning id`,
            [stableSlug(r.target.title, r.target.provider, r.target.externalId, len), r.target.title, r.target.mediaType],
          );
          if (stub.rows[0]) {
            toId = stub.rows[0].id;
            break;
          }
        }
        if (!toId) throw new Error(`Could not allocate a slug for stub ${r.target.provider}:${r.target.externalId}`);
        await q.query(
          `insert into public.title_sources (provider, external_id, title_id) values ($1, $2, $3)`,
          [r.target.provider, r.target.externalId, toId],
        );
        stubsCreated++;
      }

      if (toId === fromId) continue;
      const res = await q.query(
        `insert into public.title_relations (from_title_id, to_title_id, relation, source)
         values ($1, $2, $3, $4) on conflict do nothing`,
        [fromId, toId, r.relation, fromProvider],
      );
      edges += res.rowCount ?? 0;
    }

    let stubsRemoved = 0;
    if (previous.rows.length > 0) {
      const gone = await q.query(
        `delete from public.titles t
          where t.is_stub
            and t.id = any ($1::uuid[])
            and not exists (select 1 from public.title_relations r where r.from_title_id = t.id or r.to_title_id = t.id)`,
        [[...new Set(previous.rows.map((r) => r.to_title_id))]],
      );
      stubsRemoved = gone.rowCount ?? 0;
    }
    return { edges, stubsCreated, stubsRemoved };
  });
}
