'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { saveWatchProgressAction } from '@/app/actions/watch';
import { safeExternalUrl } from '@/lib/safe-url';
import type { WatchCatalog } from '@/lib/api/watch';

type Episode = WatchCatalog['episodes'][number];
const availabilityLabel: Record<string, string> = {
  subscription: 'Subscription',
  free: 'Free',
  ads: 'Free with ads',
  rent: 'Rent',
  buy: 'Buy',
  unknown: 'Check provider',
};

function isUnverifiedProvider(provider: WatchCatalog['providers'][number]) {
  const normalizedName = provider.provider_name.toLowerCase().replace(/[^a-z0-9]/g, '');
  let hostname = '';
  try {
    hostname = new URL(provider.url).hostname.toLowerCase().replace(/^www\\./, '');
  } catch {
    return true;
  }
  return normalizedName.includes('aniwave') || hostname.includes('aniwave');
}
const secondsLabel = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
};

export function WatchExperience({
  titleId,
  title,
  slug,
  catalog,
  isSignedIn,
}: {
  titleId: string;
  title: string;
  slug: string;
  catalog: WatchCatalog;
  isSignedIn: boolean;
}) {
  const firstEpisode = catalog.episodes.find((episode) => !episode.completed) ?? catalog.episodes[0] ?? null;
  const visibleProviders = catalog.providers.filter((provider) => !isUnverifiedProvider(provider));
  const [selectedId, setSelectedId] = useState(firstEpisode?.id ?? '');
  const [saveMessage, setSaveMessage] = useState('');
  const [progressById, setProgressById] = useState<Record<string, { position_seconds: number; duration_seconds: number | null; completed: boolean }>>({});
  const episodes = catalog.episodes.map((episode) => ({ ...episode, ...(progressById[episode.id] ?? {}) }));
  const activeEpisode = episodes.find((episode) => episode.id === selectedId) ?? firstEpisode;
  const updateProgress = (episodeId: string, progress: { position_seconds: number; duration_seconds: number; completed: boolean }) => {
    setProgressById((current) => ({ ...current, [episodeId]: progress }));
  };

  return (
    <section aria-labelledby="watch-heading" className="panel space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-violet-soft">Storyverse player</p>
        <h2 id="watch-heading" className="display mt-1 text-3xl">Watch {title}</h2>
        <p className="mt-2 text-sm text-muted">
          Official provider links and episodes with a confirmed streaming licence appear here.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Official streaming services</h3>
        {catalog.providers.length > visibleProviders.length ? (
          <p role="note" className="mt-2 text-xs text-muted">A provider destination was hidden because it could not be verified as an official streaming service.</p>
        ) : null}
        {visibleProviders.length > 0 ? (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {visibleProviders.map((provider) => {
              const href = safeExternalUrl(provider.url);
              if (!href) return null;
              return (
                <li key={provider.id} className="rounded-xl border border-line bg-raised p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{provider.provider_name}</p>
                      <p className="mt-1 text-xs text-muted">
                        {provider.country_code} · {availabilityLabel[provider.availability] ?? 'Check provider'}
                      </p>
                    </div>
                    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-primary btn-sm">
                      Watch on provider <span aria-hidden="true">↗</span>
                    </a>
                  </div>
                  {provider.audio_languages.length > 0 || provider.subtitle_languages.length > 0 ? (
                    <p className="mt-2 text-xs text-muted">
                      {provider.audio_languages.length > 0 ? `Audio: ${provider.audio_languages.join(', ')}` : ''}
                      {provider.audio_languages.length > 0 && provider.subtitle_languages.length > 0 ? ' · ' : ''}
                      {provider.subtitle_languages.length > 0 ? `Subtitles: ${provider.subtitle_languages.join(', ')}` : ''}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 rounded-lg border border-dashed border-line p-3 text-sm text-muted">
            No verified official streaming links have been added for this title yet.
          </p>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Episodes</h3>
            <p className="mt-1 text-xs text-muted">Only licensed MP4 or HLS streams can play in this player.</p>
          </div>
          {catalog.episodes.length > 0 ? (
            <label className="min-w-52">
              <span className="sr-only">Choose an episode</span>
              <select className="field" value={activeEpisode?.id ?? ''} onChange={(event) => setSelectedId(event.currentTarget.value)}>
                {episodes.map((episode) => (
                  <option key={episode.id} value={episode.id}>
                    S{episode.season_number} · E{episode.episode_number} — {episode.episode_title}
                    {episode.completed ? ' ✓' : episode.position_seconds > 0 ? ' · Resume' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {activeEpisode ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                Season {activeEpisode.season_number}, Episode {activeEpisode.episode_number}: {activeEpisode.episode_title}
              </p>
              {activeEpisode.completed ? <span className="chip">Completed</span> : activeEpisode.position_seconds > 0 ? (
                <span className="text-xs text-muted">Resume at {secondsLabel(activeEpisode.position_seconds)}</span>
              ) : null}
            </div>
            <EpisodePlayer
              key={activeEpisode.id}
              titleId={titleId}
              episode={activeEpisode}
              isSignedIn={isSignedIn}
              onStatus={setSaveMessage}
              onProgress={(progress) => updateProgress(activeEpisode.id, progress)}
            />
            {activeEpisode.synopsis ? <p className="text-sm text-muted">{activeEpisode.synopsis}</p> : null}
            <p role="status" aria-live="polite" className="text-xs text-muted">{saveMessage}</p>
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-line p-4">
            <p className="font-medium">The video player is ready, but no licensed episodes are published yet.</p>
            <p className="mt-1 text-sm text-muted">
              Add official platform links or a stream URL that you own or are licensed to distribute from the watch manager.
            </p>
            <Link href="/admin/watch" className="link mt-3 inline-block text-sm">Open watch catalogue manager</Link>
          </div>
        )}
      </div>

      {!isSignedIn ? (
        <p className="rounded-lg bg-raised p-3 text-sm text-muted">
          You can play published episodes, but watch progress syncs across devices after you{' '}
          <Link className="link" href={`/login?next=${encodeURIComponent(`/title/${slug}`)}`}>sign in</Link>.
        </p>
      ) : (
        <p className="text-xs text-muted">Your playback position is saved to your private account approximately every 15 seconds and when playback pauses.</p>
      )}
    </section>
  );
}

function EpisodePlayer({
  titleId,
  episode,
  isSignedIn,
  onStatus,
  onProgress,
}: {
  titleId: string;
  episode: Episode;
  isSignedIn: boolean;
  onStatus: (message: string) => void;
  onProgress: (progress: { position_seconds: number; duration_seconds: number; completed: boolean }) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const episodeRef = useRef(episode);
  episodeRef.current = episode;
  const lastSavedAtRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const [playbackError, setPlaybackError] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let hls: { destroy: () => void } | null = null;
    const currentEpisode = episodeRef.current;
    const source = safeExternalUrl(currentEpisode.stream_url);
    setPlaybackError('');
    onStatus('');
    lastSavedAtRef.current = currentEpisode.position_seconds;

    const resume = () => {
      if (disposed || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const savedEpisode = episodeRef.current;
      const startAt = savedEpisode.completed ? 0 : Math.min(savedEpisode.position_seconds, Math.max(0, video.duration - 2));
      if (startAt > 0) video.currentTime = startAt;
    };

    const attach = async () => {
      if (!source) {
        setPlaybackError('This episode does not have a valid secure video address.');
        return;
      }
      if (currentEpisode.stream_type === 'mp4') {
        video.src = source;
        video.addEventListener('loadedmetadata', resume, { once: true });
        return;
      }
      try {
        const hlsModule = await import('hls.js');
        if (disposed) return;
        const Hls = hlsModule.default;
        if (Hls.isSupported()) {
          const player = new Hls({ enableWorker: true, lowLatencyMode: false });
          hls = player;
          player.loadSource(source);
          player.attachMedia(video);
          player.on(Hls.Events.MANIFEST_PARSED, resume);
          player.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal && !disposed) setPlaybackError('This video source is unavailable or blocked. Replace it with an HTTPS MP4/HLS URL you own or are licensed to distribute, or use an official provider link above.');
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = source;
          video.addEventListener('loadedmetadata', resume, { once: true });
        } else {
          setPlaybackError('This browser cannot play HLS streams. Use a supported modern browser or add an MP4 source for this episode.');
        }
      } catch {
        if (!disposed && video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = source;
          video.addEventListener('loadedmetadata', resume, { once: true });
        } else if (!disposed) {
          setPlaybackError('The HLS playback module could not be loaded. Reload the page and try again.');
        }
      }
    };
    void attach();

    return () => {
      disposed = true;
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [episode.id, episode.stream_url, episode.stream_type, onStatus]);

  const persist = async (completed: boolean, force = false) => {
    const video = videoRef.current;
    if (!isSignedIn || !video || saveInFlightRef.current) return;
    const duration = Number.isFinite(video.duration) && video.duration > 0
      ? Math.floor(video.duration)
      : episode.runtime_seconds;
    if (!duration || duration < 1) return;
    const position = completed ? duration : Math.min(duration, Math.max(0, Math.floor(video.currentTime || 0)));
    if (!completed && !force && Math.abs(position - lastSavedAtRef.current) < 15) return;
    saveInFlightRef.current = true;
    try {
      const result = await saveWatchProgressAction(titleId, episode.id, position, duration, completed);
      if (result.ok) {
        lastSavedAtRef.current = position;
        onProgress({ position_seconds: position, duration_seconds: duration, completed: completed || position >= duration - 15 });
        onStatus(completed ? 'Episode marked complete.' : 'Watch progress saved.');
      } else if (result.message) {
        onStatus(result.message);
      }
    } finally {
      saveInFlightRef.current = false;
    }
  };

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-line bg-black">
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          className="aspect-video w-full bg-black"
          onTimeUpdate={() => void persist(false)}
          onPause={() => void persist(false, true)}
          onEnded={() => void persist(true)}
          onError={() => setPlaybackError('Playback failed because this video source is unavailable or blocked. Replace it with an authorized HTTPS MP4/HLS source, or use an official provider link above.')}
        >
          Your browser does not support HTML video playback.
        </video>
      </div>
      {playbackError ? <p role="alert" className="mt-2 text-sm text-bad">{playbackError}</p> : null}
    </div>
  );
}
