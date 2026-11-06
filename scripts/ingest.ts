/**
 * Import titles from an external provider into the catalog.
 *
 *   npm run ingest -- jikan anime --pages 2
 *   npm run ingest -- openlibrary books --subject "science fiction" --dry-run
 *
 * Run with --help for every option. Nothing here invents data: records come from
 * the provider, are validated, and are stored with their source and attribution.
 */
import { loadEnvFiles, parseCli, PROVIDER_NOTICES, USAGE, type CliArgs } from '../src/lib/ingest/cli';
import { pgDb } from '../src/lib/ingest/db';
import { findResumePage, jobKey, MissingCredentialsError, runIngestion } from '../src/lib/ingest/run';
import { createAdapter } from '../src/lib/providers';
import type { ProviderAdapter } from '../src/lib/providers/types';

const say = (message = '') => console.error(message);

async function dryRun(adapter: ProviderAdapter, args: CliArgs): Promise<number> {
  let page = args.startPage;
  let valid = 0;
  let rejected = 0;
  const sample: string[] = [];
  for (let n = 0; n < args.pages; n++) {
    say(`${adapter.id} ${args.kind} page ${page}`);
    const result = await adapter.listPage(args.kind, page, args.listOptions);
    valid += result.items.length;
    rejected += result.errors.length;
    for (const item of result.items) if (sample.length < 5) sample.push(`${item.title} [${item.mediaType}, ${item.externalId}]`);
    for (const bad of result.errors) say(`  ! ${bad.externalId ?? '?'}: ${bad.message}`);
    page++;
    if (!result.hasNext) break;
  }
  say();
  say(`Dry run: ${valid} valid, ${rejected} rejected. Nothing was written.`);
  for (const line of sample) say(`  e.g. ${line}`);
  return rejected > 0 ? 2 : 0;
}

async function main(argv: string[]): Promise<number> {
  loadEnvFiles(process.cwd(), process.env);

  const parsed = parseCli(argv);
  if (parsed.type === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (parsed.type === 'error') {
    say(`error: ${parsed.message}\n`);
    say(USAGE);
    return 1;
  }
  const { args } = parsed;
  const env = process.env;

  const adapter = createAdapter(args.provider, {
    env: { TMDB_READ_ACCESS_TOKEN: env.TMDB_READ_ACCESS_TOKEN, INGEST_CONTACT: env.INGEST_CONTACT },
  });
  const config = adapter.isConfigured();
  if (!config.ok) {
    say(`error: ${args.provider} is not configured. Set ${config.missing.join(', ')} (see .env.example).`);
    return 1;
  }
  if (!adapter.kinds.includes(args.kind)) {
    say(`error: ${args.provider} cannot ingest "${args.kind}". Supported: ${adapter.kinds.join(', ')}`);
    return 1;
  }
  if (args.relations && !adapter.fetchRelations) {
    say(`error: ${args.provider} does not provide relations, so --relations cannot be used`);
    return 1;
  }
  if (!env.INGEST_CONTACT) {
    if (args.provider === 'openlibrary') {
      say('error: openlibrary asks clients to identify themselves. Set INGEST_CONTACT to an email address or URL.');
      return 1;
    }
    say('warning: INGEST_CONTACT is not set, so requests carry no contact address.');
  }
  say(`notice: ${PROVIDER_NOTICES[args.provider]}`);
  say();

  if (args.dryRun) return dryRun(adapter, args);

  if (!env.DATABASE_URL) {
    say('error: DATABASE_URL is not set. It is needed to store titles (use --dry-run to only check the data).');
    return 1;
  }
  const db = pgDb(env.DATABASE_URL);
  try {
    say(`database: ${new URL(env.DATABASE_URL).hostname}`);

    let startPage = args.startPage;
    if (args.resume) {
      const page = await findResumePage(db, adapter.id, jobKey(args.kind, args.listOptions));
      if (page === undefined) say('Nothing to resume for this job; starting at page 1.');
      startPage = page ?? 1;
    }

    const summary = await runIngestion({
      db,
      adapter,
      kind: args.kind,
      listOptions: args.listOptions,
      startPage,
      pages: args.pages,
      withRelations: args.relations,
      log: say,
    });

    say();
    say(`Run ${summary.runId}: ${summary.status}`);
    say(`  seen ${summary.seen}  inserted ${summary.inserted}  updated ${summary.updated}  unchanged ${summary.unchanged}  failed ${summary.failed}`);
    if (summary.error) say(`  error: ${summary.error}`);
    if (summary.status === 'failed') say(`  continue where it stopped with: npm run ingest -- ${argv.filter((a) => a !== '--resume').join(' ')} --resume`);
    else say(`  next page: ${summary.nextPage}`);
    return summary.status === 'succeeded' ? 0 : summary.status === 'partial' ? 2 : 1;
  } finally {
    await db.close();
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof MissingCredentialsError) say(`error: ${err.message}`);
    else say(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
