'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ApiError, friendlyMessage } from '@/lib/api/errors';
import { removeLibraryEntry, saveLibraryEntry } from '@/lib/api/library';
import { LIBRARY_STATUSES, libraryEntrySchema } from '@/lib/api/schemas';
import { getBackend, getCurrentUser } from '@/lib/data';

export type LibraryFormState =
  | { status: 'idle' }
  | { status: 'saved'; at: number; message: string; entry: z.infer<typeof libraryEntrySchema> | null }
  | { status: 'error'; at: number; message: string };

// `at` lets the form show whichever of its two actions (save, remove) answered last.
const failed = (message: string): LibraryFormState => ({ status: 'error', at: Date.now(), message });

const form = z.object({
  titleId: z.string().uuid(),
  slug: z.string().min(1).max(200),
  status: z.enum(LIBRARY_STATUSES),
  progress: z
    .string()
    .trim()
    .regex(/^\d{0,7}$/, 'Progress must be a whole number.')
    .transform((s) => (s === '' ? undefined : Number(s))),
  rating: z.string().regex(/^(|[1-9]|10)$/, 'Ratings go from 1 to 10.'),
  notes: z.string().max(2000, 'Notes can be up to 2,000 characters.'),
  isPrivate: z.boolean(),
});

const field = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

function refresh(slug: string) {
  revalidatePath(`/title/${slug}`);
  revalidatePath('/library');
}

export async function saveLibraryAction(_prev: LibraryFormState, formData: FormData): Promise<LibraryFormState> {
  const parsed = form.safeParse({
    titleId: field(formData, 'titleId'),
    slug: field(formData, 'slug'),
    status: field(formData, 'status'),
    progress: field(formData, 'progress'),
    rating: field(formData, 'rating'),
    notes: field(formData, 'notes'),
    isPrivate: formData.get('isPrivate') === 'on',
  });
  if (!parsed.success) return failed(parsed.error.issues[0]?.message ?? 'Check the form and try again.');

  const backend = await getBackend();
  if (!backend.ok || !(await getCurrentUser())) return failed(friendlyMessage(new ApiError('not_authenticated')));

  const { titleId, slug, status, progress, rating, notes, isPrivate } = parsed.data;
  try {
    const entry = await saveLibraryEntry(backend.supabase, {
      titleId,
      status,
      progress,
      rating: rating === '' ? null : Number(rating),
      notes,
      isPrivate,
    });
    refresh(slug);
    return { status: 'saved', at: Date.now(), message: 'Saved to your library.', entry };
  } catch (error) {
    return failed(friendlyMessage(error));
  }
}

export async function removeLibraryAction(_prev: LibraryFormState, formData: FormData): Promise<LibraryFormState> {
  const parsed = z.object({ titleId: z.string().uuid(), slug: z.string().min(1).max(200) }).safeParse({
    titleId: field(formData, 'titleId'),
    slug: field(formData, 'slug'),
  });
  if (!parsed.success) return failed('Check the form and try again.');

  const backend = await getBackend();
  if (!backend.ok || !(await getCurrentUser())) return failed(friendlyMessage(new ApiError('not_authenticated')));

  try {
    await removeLibraryEntry(backend.supabase, parsed.data.titleId);
    refresh(parsed.data.slug);
    return { status: 'saved', at: Date.now(), message: 'Removed from your library.', entry: null };
  } catch (error) {
    return failed(friendlyMessage(error));
  }
}
