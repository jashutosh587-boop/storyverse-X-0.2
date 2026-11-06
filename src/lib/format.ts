import type { MediaType } from './providers/types';

export const MEDIA_LABEL: Record<MediaType, string> = {
  anime: 'Anime',
  movie: 'Movie',
  tv: 'TV series',
  book: 'Book',
  novel: 'Novel',
  manga: 'Manga',
  comic: 'Comic',
};

export const STATUS_LABEL: Record<string, string> = {
  announced: 'Announced',
  upcoming: 'Upcoming',
  releasing: 'Releasing',
  finished: 'Finished',
  hiatus: 'On hiatus',
  cancelled: 'Cancelled',
  unknown: 'Status unknown',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? 'Status unknown';
}

/** 1_900_000 -> "1.9M", 12_345 -> "12.3K", 999 -> "999". */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 10_000) return `${trim(n / 1_000)}K`;
  return n.toLocaleString('en-US');
}
const trim = (n: number) => (Math.round(n * 10) / 10).toString();

/** A score out of 10, up to two decimals: 8.75 -> "8.75", 7.9 -> "7.9", 9 -> "9". */
export function formatScore(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/** One decimal, for tight spaces such as a poster badge. */
export function formatScoreShort(n: number): string {
  return n.toFixed(1);
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "1998-04-03" -> "3 Apr 1998". Anything that is not a date comes back unchanged. */
export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}/.test(value) ? `${value.slice(0, 10)}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? value : DATE.format(date);
}

export function formatMonth(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : MONTH.format(date);
}

export function relationLabel(relation: string): string {
  const special: Record<string, string> = { spin_off: 'Spin-off', side_story: 'Side story', parent_story: 'Parent story' };
  if (special[relation]) return special[relation]!;
  const words = relation.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "episodes" -> "episode" when n is 1. */
export function unitLabel(unit: string | null | undefined, n: number): string {
  if (!unit || unit === 'viewing') return '';
  return n === 1 ? unit.replace(/s$/, '') : unit;
}

const WATCHED: MediaType[] = ['anime', 'movie', 'tv'];

/** The label for a library status. "In progress" reads as watching or reading depending on the medium. */
export function libraryStatusLabel(status: string, mediaType?: MediaType): string {
  const watching = mediaType ? WATCHED.includes(mediaType) : undefined;
  switch (status) {
    case 'planned':
      return watching === undefined ? 'Planned' : watching ? 'Plan to watch' : 'Plan to read';
    case 'in_progress':
      return watching === undefined ? 'In progress' : watching ? 'Watching' : 'Reading';
    case 'completed':
      return 'Completed';
    case 'paused':
      return 'On hold';
    case 'dropped':
      return 'Dropped';
    case 'repeating':
      return watching === undefined ? 'Repeating' : watching ? 'Rewatching' : 'Rereading';
    default:
      return status;
  }
}

/** Group credits by role, keeping the order roles first appear in. */
export function groupCredits<T extends { role: string }>(credits: T[]): Array<{ role: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const credit of credits) groups.set(credit.role, [...(groups.get(credit.role) ?? []), credit]);
  return [...groups].map(([role, items]) => ({ role, items }));
}

/** A label inside a sentence: "movie", but "TV series" keeps its capitals. */
export function inSentence(label: string): string {
  const first = label.split(' ')[0] ?? '';
  return first.length > 1 && first === first.toUpperCase() ? label : label.toLowerCase();
}

export function initialsOf(title: string): string {
  const words = title.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  // Array.from keeps a character outside the Basic Multilingual Plane whole instead of cutting it in half.
  return (words.slice(0, 2).map((w) => Array.from(w)[0]).join('') || '?').toUpperCase();
}

/** 116 -> "1 h 56 min", 45 -> "45 min". */
export function formatRuntime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function displayName(type: 'region' | 'language', code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type }).of(code) ?? code;
  } catch {
    return code; // not a valid code: show it as the provider gave it
  }
}

/** "JP" -> "Japan". */
export const regionName = (code: string) => displayName('region', code.toUpperCase());
/** "ja" -> "Japanese". */
export const languageName = (code: string) => displayName('language', code);
