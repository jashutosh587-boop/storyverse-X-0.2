import { describe, expect, it } from 'vitest';
import { categoryBySlug, categoryForMediaType, CATEGORIES } from '@/lib/categories';
import { MEDIA_TYPES } from '@/lib/providers/types';

/** Words that are already pages on the site, so a category slug must not take them. */
const RESERVED = [
  'about',
  'api',
  'auth',
  'forgot-password',
  'library',
  'login',
  'reset-password',
  'search',
  'settings',
  'signup',
  'title',
  'u',
  'robots.txt',
  'sitemap.xml',
];

describe('categories', () => {
  it('have unique slugs that cannot hide another page', () => {
    const slugs = CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(RESERVED).not.toContain(slug);
  });

  it('put every medium on exactly one category, except those with no browse page yet', () => {
    const counts = new Map<string, number>();
    for (const category of CATEGORIES) {
      expect(category.mediaTypes.length).toBeGreaterThan(0);
      for (const type of category.mediaTypes) counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    for (const type of MEDIA_TYPES) {
      expect(counts.get(type) ?? 0, type).toBe(type === 'comic' ? 0 : 1);
    }
  });

  it('look up both ways', () => {
    expect(categoryBySlug('anime')?.label).toBe('Anime');
    expect(categoryBySlug('nope')).toBeUndefined();
    expect(categoryBySlug('constructor')).toBeUndefined();
    expect(categoryForMediaType('movie')?.slug).toBe('movies');
    expect(categoryForMediaType('comic')).toBeUndefined();
  });
});
