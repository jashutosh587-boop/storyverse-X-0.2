'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { friendlyMessage } from '@/lib/api/errors';
import { deleteMyAccount, getProfile, updateMyProfile } from '@/lib/api/profile';
import { getBackend, getCurrentUser } from '@/lib/data';

export type ProfileFormState =
  | { status: 'idle' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string; field?: 'username' | 'displayName' | 'bio' | 'confirm' };

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

const profileForm = z.object({
  username: z.string().trim().regex(/^[A-Za-z0-9_]{3,24}$/, 'Use 3 to 24 letters, numbers or underscores.'),
  displayName: z.string().trim().max(60, 'Keep the display name to 60 characters.'),
  bio: z.string().trim().max(500, 'Keep the bio to 500 characters.'),
  isPublic: z.boolean(),
});

export async function updateProfileAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const parsed = profileForm.safeParse({
    username: text(formData, 'username'),
    displayName: text(formData, 'displayName'),
    bio: text(formData, 'bio'),
    isPublic: formData.get('isPublic') === 'on',
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const key = issue.path[0];
    return {
      status: 'error',
      message: issue.message,
      field: key === 'username' || key === 'displayName' || key === 'bio' ? key : undefined,
    };
  }

  const backend = await getBackend();
  if (!backend.ok || !(await getCurrentUser())) return { status: 'error', message: 'Sign in to change your profile.' };

  try {
    await updateMyProfile(backend.supabase, parsed.data);
    revalidatePath('/', 'layout');
    return { status: 'saved', message: 'Profile saved.' };
  } catch (error) {
    const message = friendlyMessage(error);
    return { status: 'error', message, field: /username/i.test(message) ? 'username' : undefined };
  }
}

/** Deleting an account is permanent, so it needs the username typed back as confirmation. */
export async function deleteAccountAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const backend = await getBackend();
  if (!backend.ok || !(await getCurrentUser())) return { status: 'error', message: 'Sign in to delete your account.' };

  const profile = await getProfile(backend.supabase).catch(() => null);
  if (!profile) return { status: 'error', message: 'We could not find your profile. Try again.' };
  if (text(formData, 'confirm').trim().toLowerCase() !== profile.username.toLowerCase()) {
    return { status: 'error', message: `Type ${profile.username} to confirm.`, field: 'confirm' };
  }

  try {
    await deleteMyAccount(backend.supabase);
  } catch (error) {
    return { status: 'error', message: friendlyMessage(error) };
  }
  await backend.supabase.auth.signOut().catch(() => undefined);
  redirect('/?account=deleted');
}
