import { describe, expect, it } from 'vitest';
import config from '../../next.config';
import { IMAGE_HOSTS, isAllowedImage } from '@/lib/image-hosts';

describe('image hosts', () => {
  it('match the hosts next.config.ts lets the image optimizer fetch from', () => {
    const configured = (config.images?.remotePatterns ?? []).map((p) => ('hostname' in p ? p.hostname : undefined));
    expect([...configured].sort()).toEqual([...IMAGE_HOSTS].sort());
    for (const pattern of config.images?.remotePatterns ?? []) {
      expect('protocol' in pattern ? pattern.protocol : undefined).toBe('https');
    }
  });

  it('accepts https artwork from a provider CDN', () => {
    expect(isAllowedImage('https://cdn.myanimelist.net/images/anime/1/2.jpg')).toBe(true);
    expect(isAllowedImage('https://image.tmdb.org/t/p/w500/x.jpg')).toBe(true);
    expect(isAllowedImage('https://covers.openlibrary.org/b/id/1-L.jpg')).toBe(true);
  });

  it.each([
    null,
    undefined,
    '',
    'http://cdn.myanimelist.net/a.jpg',
    'https://evil.example/a.jpg',
    'https://cdn.myanimelist.net.evil.example/a.jpg',
    'https://evil.example/cdn.myanimelist.net/a.jpg',
    'https://user@evil.example/a.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '//cdn.myanimelist.net/a.jpg',
    'not a url',
  ])('rejects %j', (url) => {
    expect(isAllowedImage(url)).toBe(false);
  });
});
