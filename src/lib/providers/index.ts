import { createHttpClient, type HttpClient } from './http';
import { createJikanAdapter } from './jikan';
import { createOpenLibraryAdapter } from './openlibrary';
import { createTmdbAdapter } from './tmdb';
import type { ProviderAdapter, ProviderId } from './types';

export interface ProviderEnv {
  TMDB_READ_ACCESS_TOKEN?: string;
  /** An address Open Library and others can reach you at if your client misbehaves. */
  INGEST_CONTACT?: string;
}

export interface CreateAdapterOptions {
  env: ProviderEnv;
  /** Replace the HTTP client (tests). */
  http?: HttpClient;
}

/** Each provider's published limits, with a little headroom. */
const LIMITS: Record<ProviderId, { minIntervalMs: number }> = {
  jikan: { minIntervalMs: 1100 }, // 3 requests/second and 60/minute
  tmdb: { minIntervalMs: 150 },
  openlibrary: { minIntervalMs: 400 }, // 3 requests/second when identified
};

export function userAgent(env: ProviderEnv): string {
  return `StoryverseX/0.1 (${env.INGEST_CONTACT ?? 'no-contact-configured'})`;
}

export function createAdapter(id: ProviderId, { env, http }: CreateAdapterOptions): ProviderAdapter {
  const client =
    http ??
    createHttpClient({
      userAgent: userAgent(env),
      minIntervalMs: LIMITS[id].minIntervalMs,
      headers: id === 'tmdb' && env.TMDB_READ_ACCESS_TOKEN ? { Authorization: `Bearer ${env.TMDB_READ_ACCESS_TOKEN}` } : {},
    });

  switch (id) {
    case 'jikan':
      return createJikanAdapter(client);
    case 'tmdb':
      return createTmdbAdapter(client, env.TMDB_READ_ACCESS_TOKEN);
    case 'openlibrary':
      return createOpenLibraryAdapter(client);
  }
}
