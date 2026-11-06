import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/safe-next';

describe('safeNext', () => {
  it('keeps same-site paths, with their query and fragment', () => {
    expect(safeNext('/library')).toBe('/library');
    expect(safeNext('/title/one-piece?x=1#reviews')).toBe('/title/one-piece?x=1#reviews');
    expect(safeNext('/search?q=a%20b')).toBe('/search?q=a%20b');
  });

  it('falls back when there is nothing usable', () => {
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext(null)).toBe('/');
    expect(safeNext('')).toBe('/');
    expect(safeNext(42)).toBe('/');
    expect(safeNext(['/a'])).toBe('/');
    expect(safeNext('', '/home')).toBe('/home');
  });

  it.each([
    'https://evil.example',
    'http://evil.example/path',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    'data:text/html,hi',
    'evil.example',
    'library',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\u0000',
  ])('rejects %j', (value) => {
    expect(safeNext(value)).toBe('/');
  });

  // The URL parser resolves dot segments, and these resolve to a protocol-relative URL (another site).
  it.each(['/..//evil.example', '/.//evil.example', '/a/..//evil.example', '/./\\evil.example'])(
    'rejects %j, which normalizes to a protocol-relative URL',
    (value) => {
      expect(safeNext(value)).toBe('/');
    },
  );

  it('accepts encoded slashes, which stay inside the path', () => {
    expect(safeNext('/%2F%2Fevil.example')).toBe('/%2F%2Fevil.example');
  });

  it('never returns anything that starts with two slashes or a backslash', () => {
    const attempts = ['/..//a', '/../..//a', '/x/../..//a', '/%2e%2e//a', '/%2E%2E//a', '/.%2e//a', '/..%2f/a'];
    for (const attempt of attempts) {
      const result = safeNext(attempt);
      expect(result.startsWith('//')).toBe(false);
      expect(result.includes('\\')).toBe(false);
      expect(result.startsWith('/')).toBe(true);
    }
  });
});
