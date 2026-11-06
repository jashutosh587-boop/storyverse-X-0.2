import { describe, expect, it } from 'vitest';
import {
  dedupeNames,
  flipName,
  hashPayload,
  normalizeGenres,
  parseDurationMinutes,
  slugify,
  stableSlug,
  stableStringify,
  toDisplayCase,
  toIsoDate,
} from '@/lib/providers/util';

describe('slugify', () => {
  it('lowercases, strips accents and punctuation', () => {
    expect(slugify('Pokémon: The First Movie!')).toBe('pokemon-the-first-movie');
    expect(slugify('Steins;Gate')).toBe('steins-gate');
    expect(slugify('Fate/Zero & Friends')).toBe('fate-zero-and-friends');
  });
  it('never returns an empty slug and respects the length limit', () => {
    expect(slugify('カウボーイビバップ')).toBe('untitled');
    expect(slugify('a'.repeat(200)).length).toBe(60);
    expect(slugify('word '.repeat(30)).endsWith('-')).toBe(false);
  });
});

describe('stableSlug', () => {
  it('is deterministic and differs between providers or ids', () => {
    expect(stableSlug('Dune', 'openlibrary', 'OL1W')).toBe(stableSlug('Dune', 'openlibrary', 'OL1W'));
    expect(stableSlug('Dune', 'openlibrary', 'OL1W')).not.toBe(stableSlug('Dune', 'openlibrary', 'OL2W'));
    expect(stableSlug('Dune', 'openlibrary', 'OL1W')).toMatch(/^dune-[0-9a-f]{6}$/);
  });
});

describe('hashing', () => {
  it('ignores key order and undefined values', () => {
    expect(hashPayload({ a: 1, b: { c: [1, 2], d: 'x' } })).toBe(hashPayload({ b: { d: 'x', c: [1, 2] }, a: 1, z: undefined }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it('changes when content changes', () => {
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
    expect(hashPayload({ a: [1, 2] })).not.toBe(hashPayload({ a: [2, 1] }));
  });
});

describe('normalizeGenres', () => {
  it('maps provider variants onto one vocabulary and removes duplicates', () => {
    expect(normalizeGenres(['Sci-Fi', 'Science Fiction', 'Action'])).toEqual(['Science Fiction', 'Action']);
    expect(normalizeGenres(['Sci-Fi & Fantasy', 'Fantasy'])).toEqual(['Science Fiction', 'Fantasy']);
    expect(normalizeGenres(['Action & Adventure'])).toEqual(['Action', 'Adventure']);
  });
  it('skips blanks and nulls, and title-cases lowercase tags only', () => {
    expect(normalizeGenres(['', '  ', null, undefined, 'space flight', 'Slice of Life'])).toEqual(['Space Flight', 'Slice of Life']);
    expect(toDisplayCase('history of the world')).toBe('History of the World');
    expect(toDisplayCase('NASA')).toBe('NASA');
  });
});

describe('dates and durations', () => {
  it('extracts a real calendar date from ISO strings', () => {
    expect(toIsoDate('1998-04-03T00:00:00+00:00')).toBe('1998-04-03');
    expect(toIsoDate('2020-02-30')).toBeUndefined();
    expect(toIsoDate('')).toBeUndefined();
    expect(toIsoDate(null)).toBeUndefined();
    expect(toIsoDate('April 1998')).toBeUndefined();
  });
  it('parses provider duration text', () => {
    expect(parseDurationMinutes('24 min per ep')).toBe(24);
    expect(parseDurationMinutes('1 hr 55 min')).toBe(115);
    expect(parseDurationMinutes('2 hr')).toBe(120);
    expect(parseDurationMinutes('30 sec per ep')).toBe(1);
    expect(parseDurationMinutes('Unknown')).toBeUndefined();
    expect(parseDurationMinutes(null)).toBeUndefined();
  });
});

describe('names', () => {
  it('flips "Last, First" and leaves other shapes alone', () => {
    expect(flipName('Oda, Eiichiro')).toBe('Eiichiro Oda');
    expect(flipName('Frank Herbert')).toBe('Frank Herbert');
    expect(flipName('Smith, Jr., John')).toBe('Smith, Jr., John');
  });
  it('dedupes alternative names case-insensitively and drops the main title', () => {
    const out = dedupeNames([{ name: 'Foo' }, { name: 'foo' }, { name: 'Bar' }, { name: 'MAIN' }], ['main']);
    expect(out.map((o) => o.name)).toEqual(['Foo', 'Bar']);
  });
});
