import { describe, expect, it } from 'vitest';
import { needsTmdbNotice, providerName, TMDB_NOTICE } from '@/lib/providers/display';

describe('providerName', () => {
  it('names the providers the site knows and falls back to the raw id for others', () => {
    expect(providerName('tmdb')).toBe('TMDB');
    expect(providerName('openlibrary')).toBe('Open Library');
    expect(providerName('something-new')).toBe('something-new');
  });
});

describe('needsTmdbNotice', () => {
  it('is not needed when TMDB data is not on the page', () => {
    expect(needsTmdbNotice([])).toBe(false);
    expect(needsTmdbNotice([{ provider: 'jikan', attribution: null }])).toBe(false);
  });

  it('is needed when TMDB data is on the page and nothing else carries the credit', () => {
    expect(needsTmdbNotice([{ provider: 'tmdb', attribution: null }])).toBe(true);
    expect(needsTmdbNotice([{ provider: 'tmdb' }])).toBe(true);
    expect(needsTmdbNotice([{ provider: 'tmdb', attribution: 'Data from TMDB.' }])).toBe(true);
  });

  it('is not repeated when the source attribution already says it', () => {
    expect(needsTmdbNotice([{ provider: 'tmdb', attribution: TMDB_NOTICE }])).toBe(false);
    expect(needsTmdbNotice([{ provider: 'tmdb', attribution: `Posters and credits. ${TMDB_NOTICE}` }])).toBe(false);
  });
});
