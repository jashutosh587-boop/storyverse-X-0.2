import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from '@/lib/safe-url';

describe('safeExternalUrl', () => {
  it('passes web addresses through', () => {
    expect(safeExternalUrl('https://myanimelist.net/anime/1')).toBe('https://myanimelist.net/anime/1');
    expect(safeExternalUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
  });

  it.each([null, undefined, '', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://x.example', 'mailto:a@b.c', '//x.example', 'not a url'])(
    'returns null for %j',
    (value) => {
      expect(safeExternalUrl(value)).toBeNull();
    },
  );
});
