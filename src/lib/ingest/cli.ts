import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PROVIDER_IDS, type ListOptions, type ProviderId } from '../providers/types';

export const USAGE = `Usage: npm run ingest -- <provider> <kind> [options]

Providers and kinds:
  jikan        anime | manga
  tmdb         movie | tv        needs TMDB_READ_ACCESS_TOKEN
  openlibrary  books             needs --subject or --query

Options:
  --pages N        how many pages to fetch (default 1)
  --start-page N   first page to fetch (default 1)
  --resume         continue the last failed or interrupted run of this job
  --relations      also store relations between titles (jikan: one extra request per title)
  --order O        popular | score | newest (default popular)
  --subject S      Open Library subject, for example "science fiction"
  --query Q        search text (jikan, openlibrary)
  --dry-run        fetch and check the data but write nothing (no database needed)
  -h, --help       show this help

Environment (shell, .env.local or .env; the shell wins):
  DATABASE_URL            direct Postgres connection string, server-side only
  TMDB_READ_ACCESS_TOKEN  TMDB API read access token
  INGEST_CONTACT          an email or URL where providers can reach you

Exit status: 0 succeeded, 2 finished with some failed items, 1 failed or could not start.
`;

/** What each provider's terms mean for running this against a product that earns money. */
export const PROVIDER_NOTICES: Record<ProviderId, string> = {
  jikan:
    'Jikan reads MyAnimeList\'s website and asks its users to respect MyAnimeList\'s terms of service. Those terms for commercial use of the data have not been verified. Read docs/DATA-SOURCES.md before building a monetized product on it.',
  tmdb:
    'TMDB\'s free API is for non-commercial use only. A product whose primary purpose is revenue needs a commercial licence from TMDB. See docs/DATA-SOURCES.md.',
  openlibrary:
    'Open Library asks API clients to identify themselves, stay near 3 requests per second and not use the API to bulk download metadata (it publishes monthly data dumps for that). See docs/DATA-SOURCES.md.',
};

export interface CliArgs {
  provider: ProviderId;
  kind: string;
  pages: number;
  startPage: number;
  resume: boolean;
  relations: boolean;
  dryRun: boolean;
  listOptions: ListOptions;
}

export type CliParse =
  | { type: 'help' }
  | { type: 'error'; message: string }
  | { type: 'run'; args: CliArgs };

const ORDERS = ['popular', 'score', 'newest'] as const;
const MAX_PAGES = 100_000;

function wholeNumber(flag: string, text: string | undefined, fallback: number): number | string {
  if (text === undefined) return fallback;
  if (!/^\d{1,6}$/.test(text) || Number(text) < 1 || Number(text) > MAX_PAGES) {
    return `${flag} must be a whole number from 1 to ${MAX_PAGES}`;
  }
  return Number(text);
}

export function parseCli(argv: string[]): CliParse {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        pages: { type: 'string' },
        'start-page': { type: 'string' },
        resume: { type: 'boolean' },
        relations: { type: 'boolean' },
        order: { type: 'string' },
        subject: { type: 'string' },
        query: { type: 'string' },
        'dry-run': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    const { code, message } = err as NodeJS.ErrnoException;
    if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
      // "--pages -1": Node cannot tell a negative number from another option.
      const flag = /'(--[a-z-]+)/.exec(message)?.[1] ?? 'an option';
      return { type: 'error', message: `${flag} needs a value (one that starts with a dash must be written ${flag}=VALUE)` };
    }
    // Node's message goes on to explain "--" handling; the first sentence is enough.
    return { type: 'error', message: message.split(/\.\s/)[0]!.replace(/\.$/, '') };
  }
  const { values, positionals } = parsed;
  if (values.help) return { type: 'help' };

  if (positionals.length !== 2) return { type: 'error', message: 'expected <provider> and <kind>' };
  const [provider, kind] = positionals as [string, string];
  if (!(PROVIDER_IDS as readonly string[]).includes(provider)) {
    return { type: 'error', message: `unknown provider "${provider}" (use ${PROVIDER_IDS.join(', ')})` };
  }
  const providerId = provider as ProviderId;

  const pages = wholeNumber('--pages', values.pages, 1);
  if (typeof pages === 'string') return { type: 'error', message: pages };
  const startPage = wholeNumber('--start-page', values['start-page'], 1);
  if (typeof startPage === 'string') return { type: 'error', message: startPage };

  if (values.order !== undefined && !(ORDERS as readonly string[]).includes(values.order)) {
    return { type: 'error', message: `--order must be one of ${ORDERS.join(', ')}` };
  }
  const subject = values.subject?.trim();
  const query = values.query?.trim();
  if (values.subject !== undefined && !subject) return { type: 'error', message: '--subject must not be empty' };
  if (values.query !== undefined && !query) return { type: 'error', message: '--query must not be empty' };
  if (subject && query) return { type: 'error', message: 'use either --subject or --query, not both' };
  if (subject && providerId !== 'openlibrary') return { type: 'error', message: `${providerId} does not support --subject` };
  if (query && providerId === 'tmdb') return { type: 'error', message: 'tmdb does not support --query' };
  if (providerId === 'openlibrary' && !subject && !query) {
    return { type: 'error', message: 'openlibrary needs --subject or --query' };
  }

  if (values.resume && values['start-page'] !== undefined) {
    return { type: 'error', message: '--resume and --start-page cannot be combined' };
  }
  if (values.resume && values['dry-run']) {
    return { type: 'error', message: '--resume needs the database, so it cannot be combined with --dry-run' };
  }

  const listOptions: ListOptions = {};
  if (values.order) listOptions.order = values.order as (typeof ORDERS)[number];
  if (subject) listOptions.subject = subject;
  if (query) listOptions.query = query;

  return {
    type: 'run',
    args: {
      provider: providerId,
      kind,
      pages,
      startPage,
      resume: values.resume === true,
      relations: values.relations === true,
      dryRun: values['dry-run'] === true,
      listOptions,
    },
  };
}

// ---------------------------------------------------------------------------
// .env files
// ---------------------------------------------------------------------------

/** KEY=value lines, optional `export`, quotes and comments. No variable expansion. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote));
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      value = value.replace(/\s+#.*$/, ''); // a comment after an unquoted value
    }
    out[match[1]!] = value;
  }
  return out;
}

/**
 * Read `.env.local` then `.env` from `dir` into `env`. A variable that is already
 * set is never replaced, so the shell wins over `.env.local`, which wins over `.env`.
 */
export function loadEnvFiles(dir: string, env: Record<string, string | undefined>): string[] {
  const loaded: string[] = [];
  for (const name of ['.env.local', '.env']) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnvFile(fs.readFileSync(file, 'utf8')))) {
      if (env[key] === undefined) env[key] = value;
    }
    loaded.push(name);
  }
  return loaded;
}
