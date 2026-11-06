import 'server-only';
import { cache } from 'react';
import { getTitle } from './api/catalog';
import { getProfile } from './api/profile';
import { createBackend } from './supabase/server';

/**
 * Per-request data helpers. React's cache() makes a repeated call within one
 * request (layout, page and metadata all asking who is signed in) cost one lookup.
 */
export const getBackend = cache(createBackend);

export const getCurrentUser = cache(async () => {
  const backend = await getBackend();
  if (!backend.ok) return null;
  const { data, error } = await backend.supabase.auth.getUser();
  return error ? null : data.user;
});

/** The signed-in user's own profile, or null when signed out. */
export const getMyProfile = cache(async () => {
  const backend = await getBackend();
  if (!backend.ok) return null;
  if (!(await getCurrentUser())) return null;
  try {
    return await getProfile(backend.supabase);
  } catch {
    return null; // the header should still render if the profile lookup fails
  }
});

export const loadTitle = cache(async (slug: string) => {
  const backend = await getBackend();
  if (!backend.ok) return null;
  return getTitle(backend.supabase, slug);
});
