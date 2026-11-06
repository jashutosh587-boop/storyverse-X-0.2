import type { SupabaseClient } from '@supabase/supabase-js';
import type { SearchArgs } from '../browse-params';
import { callRpc } from './rpc';
import {
  attributionsSchema,
  catalogStatsSchema,
  facetsSchema,
  searchResultSchema,
  similarTitlesSchema,
  suggestionsSchema,
  titleDetailSchema,
} from './schemas';
import type { MediaType } from '../providers/types';

export function searchTitles(supabase: SupabaseClient, args: SearchArgs) {
  return callRpc(
    supabase,
    'search_titles',
    {
      p_q: args.q ?? null,
      p_media_types: args.mediaTypes ?? null,
      p_genres: args.genres ?? null,
      p_year_from: args.yearFrom ?? null,
      p_year_to: args.yearTo ?? null,
      p_statuses: args.statuses ?? null,
      p_min_score: args.minScore ?? null,
      p_sort: args.sort,
      p_limit: args.limit ?? 24,
      p_offset: args.offset ?? 0,
    },
    searchResultSchema,
  );
}

export function getTitle(supabase: SupabaseClient, slug: string) {
  return callRpc(supabase, 'get_title', { p_slug: slug }, titleDetailSchema);
}

export function getSimilarTitles(supabase: SupabaseClient, titleId: string, limit = 12) {
  return callRpc(supabase, 'similar_titles_by_tags', { p_title_id: titleId, p_limit: limit }, similarTitlesSchema);
}

export function getFacets(supabase: SupabaseClient, mediaTypes?: MediaType[]) {
  return callRpc(supabase, 'title_facets', { p_media_types: mediaTypes ?? null }, facetsSchema);
}

export function suggestTitles(supabase: SupabaseClient, q: string, limit = 8) {
  return callRpc(supabase, 'suggest_titles', { p_q: q, p_limit: limit }, suggestionsSchema);
}

export function getCatalogStats(supabase: SupabaseClient) {
  return callRpc(supabase, 'catalog_stats', {}, catalogStatsSchema);
}

export function getAttributions(supabase: SupabaseClient) {
  return callRpc(supabase, 'catalog_attributions', {}, attributionsSchema);
}
