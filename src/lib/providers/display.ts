/** How providers are named and credited on the site. */
export const PROVIDER_NAME: Record<string, string> = {
  jikan: 'MyAnimeList (through the Jikan API)',
  tmdb: 'TMDB',
  openlibrary: 'Open Library',
};

export const PROVIDER_SITE: Record<string, string> = {
  jikan: 'https://myanimelist.net',
  tmdb: 'https://www.themoviedb.org',
  openlibrary: 'https://openlibrary.org',
};

/** The credit TMDB's terms require wherever its data is used. */
export const TMDB_NOTICE = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

export function providerName(provider: string): string {
  return PROVIDER_NAME[provider] ?? provider;
}

/**
 * Whether the page must add the standalone TMDB credit. It is required wherever
 * TMDB data is used, but the provider's own attribution text is the same
 * sentence, so it is added only when no source on the page already carries it.
 */
export function needsTmdbNotice(sources: ReadonlyArray<{ provider: string; attribution?: string | null }>): boolean {
  const usesTmdb = sources.some((source) => source.provider === 'tmdb');
  const alreadyShown = sources.some((source) => source.attribution?.includes(TMDB_NOTICE));
  return usesTmdb && !alreadyShown;
}
