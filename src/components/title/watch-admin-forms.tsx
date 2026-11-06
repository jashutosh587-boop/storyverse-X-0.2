'use client';

import { useState, useActionState } from 'react';
import { saveLicensedEpisodeAction, saveWatchProviderAction, type WatchActionState } from '@/app/actions/watch';
import { SubmitButton } from '@/components/submit-button';

export type WatchAdminTitle = { id: string; slug: string; title: string; release_year: number | null };
const idle: WatchActionState = { status: 'idle' };

function TitlePicker({ titles, namePrefix }: { titles: WatchAdminTitle[]; namePrefix: string }) {
  const [id, setId] = useState(titles[0]?.id ?? '');
  const selected = titles.find((title) => title.id === id) ?? titles[0];
  return (
    <div>
      <label className="label" htmlFor={`${namePrefix}-title`}>Anime title</label>
      <select id={`${namePrefix}-title`} className="field" value={selected?.id ?? ''} onChange={(event) => setId(event.currentTarget.value)} required>
        {titles.map((title) => (
          <option key={title.id} value={title.id}>{title.title}{title.release_year ? ` (${title.release_year})` : ''}</option>
        ))}
      </select>
      <input type="hidden" name="titleId" value={selected?.id ?? ''} />
      <input type="hidden" name="slug" value={selected?.slug ?? ''} />
    </div>
  );
}

function ActionMessage({ state }: { state: WatchActionState }) {
  if (state.status === 'idle') return null;
  return <p role={state.status === 'error' ? 'alert' : 'status'} className={`text-sm ${state.status === 'error' ? 'text-bad' : 'text-good'}`}>{state.message}</p>;
}

export function WatchProviderForm({ titles }: { titles: WatchAdminTitle[] }) {
  const [state, action] = useActionState(saveWatchProviderAction, idle);
  return (
    <form action={action} className="panel space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Add an official streaming service</h2>
        <p className="mt-1 text-sm text-muted">Add a verified destination on the rights-holder's official streaming platform. This is a link-out, not an embedded stream.</p>
      </div>
      <TitlePicker titles={titles} namePrefix="provider" />
      <div>
        <label className="label" htmlFor="provider-name">Service name</label>
        <input id="provider-name" className="field" name="providerName" placeholder="e.g. Crunchyroll" required minLength={2} maxLength={60} />
      </div>
      <div>
        <label className="label" htmlFor="provider-url">Official title or provider URL</label>
        <input id="provider-url" className="field" name="url" type="url" placeholder="https://..." required inputMode="url" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="provider-country">Country / region</label>
          <input id="provider-country" className="field" name="countryCode" defaultValue="IN" required maxLength={2} pattern="[A-Za-z]{2}" />
          <p className="hint">Two-letter country code, such as IN or US.</p>
        </div>
        <div>
          <label className="label" htmlFor="provider-availability">Availability type</label>
          <select id="provider-availability" name="availability" className="field" defaultValue="unknown">
            <option value="subscription">Subscription</option><option value="free">Free</option><option value="ads">Free with ads</option><option value="rent">Rent</option><option value="buy">Buy</option><option value="unknown">Check provider</option>
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="provider-audio">Audio languages</label>
          <input id="provider-audio" className="field" name="audioLanguages" placeholder="Japanese, English" maxLength={300} />
        </div>
        <div>
          <label className="label" htmlFor="provider-subtitles">Subtitle languages</label>
          <input id="provider-subtitles" className="field" name="subtitleLanguages" placeholder="English, Hindi" maxLength={300} />
        </div>
      </div>
      <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
        <input className="mt-1 size-4 accent-[var(--color-violet)]" type="checkbox" name="confirmOfficialLink" required />
        <span>I checked that this is the provider's official page and that the service information is accurate for the selected country.</span>
      </label>
      <ActionMessage state={state} />
      <SubmitButton pendingLabel="Saving provider…" className="btn btn-primary w-full">Save official link</SubmitButton>
    </form>
  );
}

export function LicensedEpisodeForm({ titles }: { titles: WatchAdminTitle[] }) {
  const [state, action] = useActionState(saveLicensedEpisodeAction, idle);
  return (
    <form action={action} className="panel space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Publish a licensed episode</h2>
        <p className="mt-1 text-sm text-muted">Only add direct HTTPS HLS (.m3u8) or MP4 sources that you own or are explicitly licensed to stream. DRM-protected platform streams must stay on their official service.</p>
      </div>
      <TitlePicker titles={titles} namePrefix="episode" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="episode-season">Season</label>
          <input id="episode-season" className="field" name="seasonNumber" type="number" min={1} max={999} defaultValue={1} required />
        </div>
        <div>
          <label className="label" htmlFor="episode-number">Episode number</label>
          <input id="episode-number" className="field" name="episodeNumber" type="number" min={1} max={99999} required />
        </div>
        <div>
          <label className="label" htmlFor="episode-runtime">Runtime (seconds)</label>
          <input id="episode-runtime" className="field" name="runtimeSeconds" type="number" min={1} max={86400} placeholder="Optional" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="episode-title">Episode title</label>
        <input id="episode-title" className="field" name="episodeTitle" required minLength={1} maxLength={160} placeholder="Episode 1" />
      </div>
      <div>
        <label className="label" htmlFor="episode-stream-url">Licensed video URL</label>
        <input id="episode-stream-url" className="field" name="streamUrl" type="url" inputMode="url" placeholder="https://cdn.your-domain.com/episode-01.m3u8" required />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="episode-format">Stream format</label>
          <select id="episode-format" className="field" name="streamType" defaultValue="hls"><option value="hls">HLS (.m3u8)</option><option value="mp4">MP4</option></select>
        </div>
        <div>
          <label className="label" htmlFor="episode-rights-holder">Rights holder / licensor</label>
          <input id="episode-rights-holder" className="field" name="rightsHolder" required minLength={2} maxLength={160} placeholder="Your studio / company / rights holder" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="episode-license-reference">Licence reference (optional)</label>
        <input id="episode-license-reference" className="field" name="licenseReference" maxLength={500} placeholder="Agreement reference or rights documentation URL" />
      </div>
      <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
        <input className="mt-1 size-4 accent-[var(--color-violet)]" type="checkbox" name="confirmRights" required />
        <span>I confirm that I own this video or have permission from the rights holder to stream and distribute it on Storyverse X.</span>
      </label>
      <p className="hint">This confirmation is stored with the episode. Only confirmed, published episodes are returned to the public video player.</p>
      <ActionMessage state={state} />
      <SubmitButton pendingLabel="Publishing episode…" className="btn btn-primary w-full">Publish licensed episode</SubmitButton>
    </form>
  );
}
