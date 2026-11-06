import type { TitleDetail } from '@/lib/api/schemas';
import { formatDate } from '@/lib/format';
import { needsTmdbNotice, providerName, TMDB_NOTICE } from '@/lib/providers/display';
import { safeExternalUrl } from '@/lib/safe-url';

/** Where this title's facts came from, when, and the credit each provider asks for. */
export function Sources({ sources }: { sources: TitleDetail['sources'] }) {
  if (sources.length === 0) return null;
  return (
    <section aria-labelledby="sources-heading">
      <h2 id="sources-heading" className="display text-3xl">
        Sources
      </h2>
      <ul className="mt-4 space-y-3">
        {sources.map((source) => {
          const href = safeExternalUrl(source.url);
          return (
            <li key={`${source.provider}:${source.external_id}`} className="text-sm">
              <p>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="link">
                    {providerName(source.provider)}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  providerName(source.provider)
                )}
                <span className="text-muted">, last fetched {formatDate(source.fetched_at) ?? 'at an unknown time'}</span>
              </p>
              {source.attribution ? <p className="text-muted">{source.attribution}</p> : null}
            </li>
          );
        })}
      </ul>
      {needsTmdbNotice(sources) ? <p className="mt-3 text-sm text-muted">{TMDB_NOTICE}</p> : null}
    </section>
  );
}
