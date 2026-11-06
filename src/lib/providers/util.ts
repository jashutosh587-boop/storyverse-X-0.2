import { createHash } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** JSON with sorted keys, so equal payloads always hash equally. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',');
  return `{${body}}`;
}

export function hashPayload(raw: unknown): string {
  return sha256(stableStringify(raw));
}

export function slugify(input: string, maxLength = 60): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return base || 'untitled';
}

/** A readable slug that stays the same every time the same record is ingested. */
export function stableSlug(name: string, provider: string, externalId: string, hashLength = 6): string {
  return `${slugify(name)}-${sha256(`${provider}:${externalId}`).slice(0, hashLength)}`;
}

const SMALL_WORDS = new Set(['of', 'and', 'the', 'in', 'a', 'an', 'to', 'for']);

/** Title-case an all-lowercase label; leave anything already cased alone. */
export function toDisplayCase(name: string): string {
  const trimmed = name.trim();
  if (trimmed !== trimmed.toLowerCase()) return trimmed;
  return trimmed
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Providers disagree on genre names ("Sci-Fi" vs "Science Fiction"). Map the
 * common variants onto one vocabulary so filters work across media.
 */
const GENRE_ALIASES: Record<string, string[]> = {
  'sci-fi': ['Science Fiction'],
  'sci fi': ['Science Fiction'],
  'science-fiction': ['Science Fiction'],
  'science fiction': ['Science Fiction'],
  'sci-fi & fantasy': ['Science Fiction', 'Fantasy'],
  'action & adventure': ['Action', 'Adventure'],
  'war & politics': ['War', 'Politics'],
  'slice of life': ['Slice of Life'],
  'tv movie': [],
};

export function normalizeGenres(names: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = raw?.trim();
    if (!name) continue;
    const mapped = GENRE_ALIASES[name.toLowerCase()] ?? [toDisplayCase(name)];
    for (const g of mapped) if (!out.includes(g)) out.push(g);
  }
  return out;
}

/** 'YYYY-MM-DD' or an ISO datetime to 'YYYY-MM-DD'; anything else is undefined. */
export function toIsoDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function yearOf(isoDate: string | undefined): number | undefined {
  return isoDate ? Number(isoDate.slice(0, 4)) : undefined;
}

/** '24 min per ep' -> 24, '1 hr 55 min' -> 115, '2 hr' -> 120, 'Unknown' -> undefined. */
export function parseDurationMinutes(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const hours = /(\d+)\s*hr/i.exec(text);
  const minutes = /(\d+)\s*min/i.exec(text);
  const seconds = /(\d+)\s*sec/i.exec(text);
  if (!hours && !minutes && !seconds) return undefined;
  const total =
    (hours ? Number(hours[1]) * 60 : 0) +
    (minutes ? Number(minutes[1]) : 0) +
    (!hours && !minutes && seconds ? Math.ceil(Number(seconds[1]) / 60) : 0);
  return total > 0 ? total : undefined;
}

/** 'Oda, Eiichiro' -> 'Eiichiro Oda'. Anything not shaped "Last, First" is returned as is. */
export function flipName(name: string): string {
  const parts = name.split(',').map((p) => p.trim());
  if (parts.length === 2 && parts[0] && parts[1]) return `${parts[1]} ${parts[0]}`;
  return name.trim();
}

/** Keep the first occurrence of each name, ignoring case. */
export function dedupeNames<T extends { name: string }>(items: T[], exclude: ReadonlyArray<string | undefined> = []): T[] {
  const seen = new Set(exclude.filter(Boolean).map((s) => s!.trim().toLowerCase()));
  const out: T[] = [];
  for (const item of items) {
    const key = item.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
