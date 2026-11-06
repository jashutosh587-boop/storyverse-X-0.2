import type { TitleDetail } from '@/lib/api/schemas';
import { formatCount, formatScore } from '@/lib/format';

type Detail = TitleDetail;

/**
 * Two scores that are never blended: the outside provider's (sky) and the
 * ratings Storyverse members have given (violet). Each says where it comes from.
 */
export function Scores({ title, community }: { title: Detail['title']; community: Detail['community'] }) {
  const providerScore = title.provider_score;
  const hasMembers = community.count > 0 && community.average !== null;

  return (
    <section aria-label="Scores" className="grid gap-3 sm:grid-cols-2">
      <div className="panel">
        <h2 className="text-sm font-semibold">{title.provider_score_source ? `Score on ${title.provider_score_source}` : 'Score from the data source'}</h2>
        {providerScore !== null ? (
          <>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="display tnum text-5xl text-sky">{formatScore(providerScore)}</span>
              <span className="text-muted">out of 10</span>
            </p>
            <p className="text-sm text-muted">
              {title.provider_score_count ? `From ${formatCount(title.provider_score_count)} ratings` : 'The number of ratings was not provided'}
            </p>
          </>
        ) : (
          <p className="mt-2 text-muted">The data source has no score for this title.</p>
        )}
      </div>

      <div className="panel">
        <h2 className="text-sm font-semibold">Storyverse members</h2>
        {hasMembers ? (
          <>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="display tnum text-5xl text-violet-soft">{formatScore(community.average!)}</span>
              <span className="text-muted">out of 10</span>
            </p>
            <p className="text-sm text-muted">
              Average of {community.count.toLocaleString('en-US')} {community.count === 1 ? 'rating' : 'ratings'}
            </p>
            <RatingDistribution distribution={community.distribution} />
          </>
        ) : (
          <p className="mt-2 text-muted">Nobody has rated this yet. Add it to your library and rate it to be the first.</p>
        )}
      </div>
    </section>
  );
}

/** How many members gave each score from 1 to 10. */
function RatingDistribution({ distribution }: { distribution: Record<string, number> }) {
  const counts = Array.from({ length: 10 }, (_, i) => i + 1).map((score) =>
    Object.entries(distribution).reduce((sum, [key, n]) => (Math.round(Number(key)) === score ? sum + n : sum), 0),
  );
  const max = Math.max(...counts, 1);
  const summary = counts
    .map((n, i) => ({ score: i + 1, n }))
    .filter(({ n }) => n > 0)
    .reverse()
    .map(({ score, n }) => `${n} gave ${score}`)
    .join(', ');

  return (
    <figure className="mt-4">
      <div role="img" aria-label={`Ratings by score: ${summary}`} className="flex h-14 items-end gap-1">
        {counts.map((n, i) => (
          <div key={i} className="flex h-full flex-1 items-end">
            <div className="w-full rounded-sm bg-violet" style={{ height: `${n === 0 ? 0 : Math.max(8, (n / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="tnum mt-1 flex gap-1 text-xs text-muted">
        {counts.map((_, i) => (
          <span key={i} className="flex-1 text-center">
            {i + 1}
          </span>
        ))}
      </div>
    </figure>
  );
}
