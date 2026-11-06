import type { MediaType } from './providers/types';

export interface Category {
  /** The URL segment: /anime, /movies, ... */
  slug: string;
  label: string;
  mediaTypes: MediaType[];
  /** What belongs here, in one line. */
  blurb: string;
}

export const CATEGORIES: readonly Category[] = [
  { slug: 'anime', label: 'Anime', mediaTypes: ['anime'], blurb: 'Series, films and specials from Japanese animation.' },
  { slug: 'movies', label: 'Movies', mediaTypes: ['movie'], blurb: 'Feature films.' },
  { slug: 'tv', label: 'TV', mediaTypes: ['tv'], blurb: 'Television series.' },
  { slug: 'books', label: 'Books', mediaTypes: ['book'], blurb: 'Books and other written works.' },
  { slug: 'novels', label: 'Novels', mediaTypes: ['novel'], blurb: 'Novels and light novels.' },
  { slug: 'manga', label: 'Manga', mediaTypes: ['manga'], blurb: 'Manga, manhwa and manhua.' },
];

export function categoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

export function categoryForMediaType(type: MediaType): Category | undefined {
  return CATEGORIES.find((c) => c.mediaTypes.includes(type));
}
