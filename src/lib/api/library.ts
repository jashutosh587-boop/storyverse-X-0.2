import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { callRpc } from './rpc';
import { libraryEntrySchema, libraryListSchema, type LibraryStatus } from './schemas';

export function getLibraryEntry(supabase: SupabaseClient, titleId: string) {
  return callRpc(supabase, 'get_library_entry', { p_title_id: titleId }, libraryEntrySchema.nullable());
}

export interface LibraryChange {
  titleId: string;
  status?: LibraryStatus;
  progress?: number;
  /** A number from 1 to 10, or null to remove the rating. Omit to leave it as it is. */
  rating?: number | null;
  notes?: string;
  isPrivate?: boolean;
}

export function saveLibraryEntry(supabase: SupabaseClient, change: LibraryChange) {
  return callRpc(
    supabase,
    'upsert_library_entry',
    {
      p_title_id: change.titleId,
      p_status: change.status ?? null,
      p_progress: change.progress ?? null,
      p_rating: typeof change.rating === 'number' ? change.rating : null,
      p_clear_rating: change.rating === null,
      p_notes: change.notes ?? null,
      p_is_private: change.isPrivate ?? null,
    },
    libraryEntrySchema,
  );
}

export function removeLibraryEntry(supabase: SupabaseClient, titleId: string) {
  return callRpc(supabase, 'remove_library_entry', { p_title_id: titleId }, z.boolean());
}

export function listLibrary(
  supabase: SupabaseClient,
  options: { userId?: string; status?: LibraryStatus; limit?: number; offset?: number } = {},
) {
  return callRpc(
    supabase,
    'list_library',
    {
      p_user_id: options.userId ?? null,
      p_status: options.status ?? null,
      p_limit: options.limit ?? 60,
      p_offset: options.offset ?? 0,
    },
    libraryListSchema,
  );
}
