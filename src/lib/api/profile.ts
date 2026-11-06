import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { callRpc } from './rpc';
import { profileSchema } from './schemas';

/** A profile by username, or the signed-in user's own when no username is given. */
export function getProfile(supabase: SupabaseClient, username?: string) {
  return callRpc(supabase, 'get_profile', { p_username: username ?? null }, profileSchema.nullable());
}

export interface ProfileChange {
  username?: string;
  displayName?: string;
  bio?: string;
  isPublic?: boolean;
}

export function updateMyProfile(supabase: SupabaseClient, change: ProfileChange) {
  return callRpc(
    supabase,
    'update_my_profile',
    {
      p_username: change.username ?? null,
      p_display_name: change.displayName ?? null,
      p_bio: change.bio ?? null,
      p_is_public: change.isPublic ?? null,
    },
    profileSchema,
  );
}

export function isUsernameAvailable(supabase: SupabaseClient, username: string) {
  return callRpc(supabase, 'username_available', { p_username: username }, z.boolean());
}

export function exportMyData(supabase: SupabaseClient) {
  return callRpc(supabase, 'export_my_data', {}, z.record(z.string(), z.unknown()));
}

export function deleteMyAccount(supabase: SupabaseClient) {
  return callRpc(supabase, 'delete_my_account', {}, z.null());
}
