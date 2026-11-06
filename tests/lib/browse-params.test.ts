import { describe, expect, it } from 'vitest';
import {
  hasActiveFilters,
  PAGE_SIZE,
  parseBrowseParams,
  toQueryString,
  toSearchArgs,
  type BrowseParams,
  type RawSearchParams,
} from '@/lib/browse-params';

/** What Next hands a page for ?a=1&a=2&b=3. */
function raw(query: string): RawSearchParams {
  const out: RawSearchParams = {};
  for (const [key, value] of new URLSearchParams(query)) {
    const current = out[key];
    out[key] = current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value];
  }
  return out;
}

describe('parseBrowseParams', () => {
  it('has sensible defaults', () => {
    expect(parseBrowseParams({})).toEqual({
      q: undefined,
      genres: [],
      statuses: [],
      yearFrom: undefined,
      yearTo: undefined,
      minScore: undefined,
      sort: 'popularity',
      page: 1,
    });
  });

  it('sorts by best match when there is a search, and by popularity when there is not', () => {
    expect(parseBrowseParams(raw('q=naruto')).sort).toBe('relevance');
    expect(parseBrowseParams(raw('q=naruto&sort=score')).sort).toBe('score');
    expect(parseBrowseParams(raw('sort=relevance')).sort).toBe('popularity');
    expect(parseBrowseParams(raw('sort=drop%20table')).sort).toBe('popularity');
  });

  it('trims and limits the search text', () => {
    expect(parseBrowseParams(raw('q=%20%20berserk%20%20')).q).toBe('berserk');
    expect(parseBrowseParams(raw('q=%20%20')).q).toBeUndefined();
    expect(parseBrowseParams({ q: 'x'.repeat(500) }).q).toHaveLength(200);
  });

  it('takes the first value when a single-value setting is repeated', () => {
    expect(parseBrowseParams(raw('q=one&q=two')).q).toBe('one');
    expect(parseBrowseParams(raw('page=2&page=3')).page).toBe(2);
  });

  it('collects genres once each, drops blanks and overlong values, and caps the count', () => {
    expect(parseBrowseParams(raw('genre=Action&genre=%20Action%20&genre=&genre=Drama')).genres).toEqual(['Action', 'Drama']);
    expect(parseBrowseParams({ genre: ['x'.repeat(61), 'Fine'] }).genres).toEqual(['Fine']);
    const many = Array.from({ length: 30 }, (_, i) => `g${i}`);
    expect(parseBrowseParams({ genre: many }).genres).toHaveLength(12);
  });

  it('keeps only known statuses', () => {
    expect(parseBrowseParams(raw('status=finished&status=bogus&status=releasing&status=finished')).statuses).toEqual(['finished', 'releasing']);
  });

  it('reads years as whole numbers in range and swaps them when reversed', () => {
    expect(parseBrowseParams(raw('from=1990&to=2005'))).toMatchObject({ yearFrom: 1990, yearTo: 2005 });
    expect(parseBrowseParams(raw('from=2010&to=2000'))).toMatchObject({ yearFrom: 2000, yearTo: 2010 });
    expect(parseBrowseParams(raw('from=abc&to=20.5'))).toMatchObject({ yearFrom: undefined, yearTo: undefined });
    expect(parseBrowseParams(raw('from=999&to=3001'))).toMatchObject({ yearFrom: undefined, yearTo: undefined });
    expect(parseBrowseParams(raw('from=-5'))).toMatchObject({ yearFrom: undefined });
  });

  it('reads the minimum score as 0.1 to 10 with at most one decimal', () => {
    expect(parseBrowseParams(raw('min=7.5')).minScore).toBe(7.5);
    expect(parseBrowseParams(raw('min=8')).minScore).toBe(8);
    expect(parseBrowseParams(raw('min=10')).minScore).toBe(10);
    for (const bad of ['0', '0.0', '11', '7.55', 'abc', '-1', '1e1', '']) {
      expect(parseBrowseParams({ min: bad }).minScore, `min=${bad}`).toBeUndefined();
    }
  });

  it('keeps the page between 1 and 500', () => {
    expect(parseBrowseParams(raw('page=3')).page).toBe(3);
    expect(parseBrowseParams(raw('page=500')).page).toBe(500);
    for (const bad of ['0', '501', '-2', 'x', '1.5', '', '99999999']) {
      expect(parseBrowseParams({ page: bad }).page, `page=${bad}`).toBe(1);
    }
  });
});

describe('toQueryString', () => {
  const base = parseBrowseParams({});

  it('is empty for the defaults', () => {
    expect(toQueryString(base)).toBe('');
  });

  it('leaves out the sort that the search text already implies', () => {
    expect(toQueryString(parseBrowseParams(raw('q=a')))).toBe('?q=a');
    expect(toQueryString(parseBrowseParams(raw('q=a&sort=score')))).toBe('?q=a&sort=score');
    expect(toQueryString(parseBrowseParams(raw('sort=score')))).toBe('?sort=score');
  });

  it('applies a patch without changing the original', () => {
    const params = parseBrowseParams(raw('genre=Action&page=3'));
    expect(toQueryString(params, { page: 1 })).toBe('?genre=Action');
    expect(toQueryString(params, { genres: [] })).toBe('?page=3');
    expect(params.page).toBe(3);
  });

  it('encodes awkward text', () => {
    expect(toQueryString(parseBrowseParams({ q: 'a&b=c d' }))).toBe('?q=a%26b%3Dc+d');
  });

  it('survives a round trip through the URL', () => {
    const params: BrowseParams = {
      q: 'steins; gate',
      genres: ['Sci-Fi', 'Thriller & Mystery'],
      statuses: ['finished', 'hiatus'],
      yearFrom: 2009,
      yearTo: 2012,
      minScore: 8.5,
      sort: 'score',
      page: 4,
    };
    expect(parseBrowseParams(raw(toQueryString(params).slice(1)))).toEqual(params);
  });
});

describe('toSearchArgs', () => {
  it('turns the page number into an offset and passes the media types through', () => {
    const args = toSearchArgs(parseBrowseParams(raw('page=3&genre=Drama')), ['anime']);
    expect(args).toMatchObject({ mediaTypes: ['anime'], genres: ['Drama'], limit: PAGE_SIZE, offset: PAGE_SIZE * 2, sort: 'popularity' });
  });

  it('sends nothing for filters that are not set', () => {
    const args = toSearchArgs(parseBrowseParams({}));
    expect(args.genres).toBeUndefined();
    expect(args.statuses).toBeUndefined();
    expect(args.mediaTypes).toBeUndefined();
    expect(args.offset).toBe(0);
  });
});

describe('hasActiveFilters', () => {
  it('is true for any narrowing filter, but not for search text, sort or page', () => {
    expect(hasActiveFilters(parseBrowseParams({}))).toBe(false);
    expect(hasActiveFilters(parseBrowseParams(raw('q=a&sort=title&page=2')))).toBe(false);
    for (const query of ['genre=Action', 'status=finished', 'from=2000', 'to=2000', 'min=5']) {
      expect(hasActiveFilters(parseBrowseParams(raw(query))), query).toBe(true);
    }
  });
});
