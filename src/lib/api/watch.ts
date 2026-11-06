import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { callRpc } from './rpc';
import { watchCatalogSchema } from './schemas';

export type WatchCatalog = z.infer<typeof watchCatalogSchema>;

export function getWatchCatalog(supabase: SupabaseClient, titleId: string) {
  return callRpc(supabase, 'get_watch_catalog', { p_title_id: titleId }, watchCatalogSchema);
}

export function saveWatchProgress(
  supabase: SupabaseClient,
  input: {
    titleId: string;
    episodeId: string;
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
  },
) {
  return callRpc(
    supabase,
    'save_watch_progress',
    {
      p_title_id: input.titleId,
      p_episode_id: input.episodeId,
      p_position_seconds: input.positionSeconds,
      p_duration_seconds: input.durationSeconds,
      p_completed: input.completed,
    },
    z.object({
      episode_id: z.string().uuid(),
      position_seconds: z.number(),
      duration_seconds: z.number(),
      completed: z.boolean(),
      updated_at: z.string(),
    }),
  );
}

export function isWatchCatalogAdmin(supabase: SupabaseClient) {
  return callRpc(supabase, 'is_watch_catalog_admin', {}, z.boolean());
}

export function upsertWatchProvider(
  supabase: SupabaseClient,
  input: {
    titleId: string;
    providerName: string;
    url: string;
    countryCode: string;
    availability: string;
    audioLanguages: string[];
    subtitleLanguages: string[];
  },
) {
  return callRpc(
    supabase,
    'upsert_watch_provider',
    {
      p_title_id: input.titleId,
      p_provider_name: input.providerName,
      p_url: input.url,
      p_country_code: input.countryCode,
      p_availability: input.availability,
      p_audio_languages: input.audioLanguages,
      p_subtitle_languages: input.subtitleLanguages,
    },
    z.string().uuid(),
  );
}

export function upsertWatchEpisode(
  supabase: SupabaseClient,
  input: {
    titleId: string;
    seasonNumber: number;
    episodeNumber: number;
    episodeTitle: string;
    runtimeSeconds: number | null;
    streamUrl: string;
    streamType: 'hls' | 'mp4';
    rightsHolder: string;
    licenseReference: string | null;
    confirmedRights: boolean;
  },
) {
  return callRpc(
    supabase,
    'upsert_watch_episode',
    {
      p_title_id: input.titleId,
      p_season_number: input.seasonNumber,
      p_episode_number: input.episodeNumber,
      p_episode_title: input.episodeTitle,
      p_runtime_seconds: input.runtimeSeconds,
      p_stream_url: input.streamUrl,
      p_stream_type: input.streamType,
      p_rights_holder: input.rightsHolder,
      p_license_reference: input.licenseReference,
      p_confirmed_rights: input.confirmedRights,
    },
    z.string().uuid(),
  );
}
