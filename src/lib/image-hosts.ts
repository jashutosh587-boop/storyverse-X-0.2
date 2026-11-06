/**
 * Hosts the app is willing to load artwork from: the providers' own image CDNs.
 * next.config.ts lists the same hosts for the image optimizer (a test keeps the
 * two in step), and anything else renders the placeholder instead of an image.
 */
export const IMAGE_HOSTS = ['cdn.myanimelist.net', 'image.tmdb.org', 'covers.openlibrary.org'] as const;

export function isAllowedImage(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (IMAGE_HOSTS as readonly string[]).includes(parsed.hostname);
  } catch {
    return false;
  }
}
