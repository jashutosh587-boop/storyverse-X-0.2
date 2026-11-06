'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { friendlyMessage } from '@/lib/api/errors';
import { saveWatchProgress, upsertWatchEpisode, upsertWatchProvider } from '@/lib/api/watch';
import { getBackend, getCurrentUser } from '@/lib/data';

export type WatchActionState =
  | { status: 'idle' }
  | { status: 'saved'; message: string; at: number }
  | { status: 'error'; message: string; at: number };

const idle: WatchActionState = { status: 'idle' };
const fail = (message: string): WatchActionState => ({ status: 'error', message, at: Date.now() });
const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};
const httpsUrl = z.string().trim().url().refine((value) => value.startsWith('https://'), 'Use a secure HTTPS URL.');
const languageList = (value: string) =>
  [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean).map((item) => item.slice(0, 40)))].slice(0, 12);

const providerForm = z.object({
  titleId: z.string().uuid(),
  slug: z.string().min(1).max(200),
  providerName: z.string().trim().min(2).max(60),
  url: httpsUrl,
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  availability: z.enum(['subscription', 'free', 'ads', 'rent', 'buy', 'unknown']),
  audioLanguages: z.string().max(300),
  subtitleLanguages: z.string().max(300),
  confirmOfficialLink: z.boolean().refine(Boolean, 'Confirm that the provider link is official and accurate for the selected country.'),
});

const episodeForm = z.object({
  titleId: z.string().uuid(),
  slug: z.string().min(1).max(200),
  seasonNumber: z.coerce.number().int().min(1).max(999),
  episodeNumber: z.coerce.number().int().min(1).max(99999),
  episodeTitle: z.string().trim().min(1).max(160),
  runtimeSeconds: z.string().trim().regex(/^$|^\d{1,5}$/).transform((value) => (value ? Number(value) : null)),
  streamUrl: httpsUrl,
  streamType: z.enum(['hls', 'mp4']),
  rightsHolder: z.string().trim().min(2).max(160),
  licenseReference: z.string().trim().max(500),
  confirmRights: z.boolean().refine(Boolean, 'Confirm that you have streaming/distribution rights for this episode.'),
});

export async function saveWatchProgressAction(
  titleId: string,
  episodeId: string,
  positionSeconds: number,
  durationSeconds: number,
  completed: boolean,
): Promise<{ ok: boolean; message?: string }> {
  const parsed = z.object({
    titleId: z.string().uuid(),
    episodeId: z.string().uuid(),
    positionSeconds: z.number().int().min(0).max(86400),
    durationSeconds: z.number().int().min(1).max(86400),
    completed: z.boolean(),
  }).safeParse({ titleId, episodeId, positionSeconds, durationSeconds, completed });
  if (!parsed.success) return { ok: false, message: 'Playback progress was not valid.' };

  const backend = await getBackend();
  if (!backend.ok || !(await getCurrentUser())) return { ok: false, message: 'Sign in to sync your watch progress.' };
  try {
    await saveWatchProgress(backend.supabase, {
      titleId: parsed.data.titleId,
      episodeId: parsed.data.episodeId,
      positionSeconds: parsed.data.positionSeconds,
      durationSeconds: parsed.data.durationSeconds,
      completed: parsed.data.completed,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: friendlyMessage(error) };
  }
}

export async function saveWatchProviderAction(
  _previous: WatchActionState,
  formData: FormData,
): Promise<WatchActionState> {
  const parsed = providerForm.safeParse({
    titleId: text(formData, 'titleId'),
    slug: text(formData, 'slug'),
    providerName: text(formData, 'providerName'),
    url: text(formData, 'url'),
    countryCode: text(formData, 'countryCode'),
    availability: text(formData, 'availability'),
    audioLanguages: text(formData, 'audioLanguages'),
    subtitleLanguages: text(formData, 'subtitleLanguages'),
    confirmOfficialLink: formData.get('confirmOfficialLink') === 'on',
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the provider details.');
  const backend = await getBackend();
  if (!backend.ok || !(await getCurrentUser())) return fail('Sign in with an authorized catalogue-admin account.');
  try {
    await upsertWatchProvider(backend.supabase, {
      titleId: parsed.data.titleId,
      providerName: parsed.data.providerName,
      url: parsed.data.url,
      countryCode: parsed.data.countryCode,
      availability: parsed.data.availability,
      audioLanguages: languageList(parsed.data.audioLanguages),
      subtitleLanguages: languageList(parsed.data.subtitleLanguages),
    });
    revalidatePath(`/title/${parsed.data.slug}`);
    revalidatePath('/admin/watch');
    return { status: 'saved', at: Date.now(), message: 'Official provider link saved.' };
  } catch (error) {
    return fail(friendlyMessage(error));
  }
}

export async function saveLicensedEpisodeAction(
  _previous: WatchActionState,
  formData: FormData,
): Promise<WatchActionState> {
  const parsed = episodeForm.safeParse({
    titleId: text(formData, 'titleId'),
    slug: text(formData, 'slug'),
    seasonNumber: text(formData, 'seasonNumber'),
    episodeNumber: text(formData, 'episodeNumber'),
    episodeTitle: text(formData, 'episodeTitle'),
    runtimeSeconds: text(formData, 'runtimeSeconds'),
    streamUrl: text(formData, 'streamUrl'),
    streamType: text(formData, 'streamType'),
    rightsHolder: text(formData, 'rightsHolder'),
    licenseReference: text(formData, 'licenseReference'),
    confirmRights: formData.get('confirmRights') === 'on',
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the episode details.');
  const backend = await getBackend();
  if (!backend.ok || !(await getCurrentUser())) return fail('Sign in with an authorized catalogue-admin account.');
  try {
    await upsertWatchEpisode(backend.supabase, {
      titleId: parsed.data.titleId,
      seasonNumber: parsed.data.seasonNumber,
      episodeNumber: parsed.data.episodeNumber,
      episodeTitle: parsed.data.episodeTitle,
      runtimeSeconds: parsed.data.runtimeSeconds,
      streamUrl: parsed.data.streamUrl,
      streamType: parsed.data.streamType,
      rightsHolder: parsed.data.rightsHolder,
      licenseReference: parsed.data.licenseReference || null,
      confirmedRights: parsed.data.confirmRights,
    });
    revalidatePath(`/title/${parsed.data.slug}`);
    revalidatePath('/admin/watch');
    return { status: 'saved', at: Date.now(), message: 'Licensed episode saved and published.' };
  } catch (error) {
    return fail(friendlyMessage(error));
  }
}
