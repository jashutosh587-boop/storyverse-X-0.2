import type { Metadata } from 'next';
import Link from 'next/link';
import { SetupRequired } from '@/components/states';
import { getAttributions } from '@/lib/api/catalog';
import { getBackend } from '@/lib/data';
import { formatDate } from '@/lib/format';
import { needsTmdbNotice, PROVIDER_SITE, providerName, TMDB_NOTICE } from '@/lib/providers/display';
import { safeExternalUrl } from '@/lib/safe-url';

export const metadata: Metadata = {
  title: 'Data sources and scores',
  description: 'Where every title comes from, how scores are shown and ranked, and what is kept about members.',
};

export default async function AboutPage() {
  const backend = await getBackend();
  if (!backend.ok) return <SetupRequired problems={backend.problems} />;
  const attributions = await getAttributions(backend.supabase).catch(() => null);

  return (
    <div className="shell py-10">
      <h1 className="display text-5xl md:text-6xl">Data sources and scores</h1>
      <p className="mt-3 max-w-prose text-lg text-muted">
        Storyverse X is a catalog of anime, film, TV, books, novels and manga that links related titles together and lets members keep a
        library. It is an independent project. Everything below is how it works today.
      </p>

      <div className="mt-12 grid max-w-3xl gap-14">
        <section aria-labelledby="sources-heading">
          <h2 id="sources-heading" className="display text-3xl">
            Where the data comes from
          </h2>
          <p className="mt-2 max-w-prose">
            Every title is imported from an outside provider. Synopses, artwork, release details and scores belong to those providers and are
            shown with credit. Storyverse X does not rewrite them, and it does not invent ratings or descriptions: when a provider has
            nothing for a field, the page says so.
          </p>

          {attributions === null ? (
            <p role="alert" className="notice notice-error mt-4 text-sm">
              The list of sources could not be loaded right now. Try again in a moment.
            </p>
          ) : attributions.length === 0 ? (
            <p className="notice mt-4 text-sm">No data has been imported yet, so there are no sources to list.</p>
          ) : (
            <ul className="mt-5 space-y-4">
              {attributions.map((source) => {
                const site = safeExternalUrl(PROVIDER_SITE[source.provider]);
                return (
                  <li key={source.provider} className="panel">
                    <p className="font-semibold">
                      {site ? (
                        <a href={site} target="_blank" rel="noopener noreferrer" className="link">
                          {providerName(source.provider)}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        providerName(source.provider)
                      )}
                    </p>
                    <p className="tnum text-sm text-muted">
                      {source.titles.toLocaleString('en-US')} {source.titles === 1 ? 'title' : 'titles'}
                      {source.last_fetched_at ? `, last fetched ${formatDate(source.last_fetched_at)}` : ''}
                    </p>
                    {source.attribution ? <p className="mt-2 text-sm">{source.attribution}</p> : null}
                  </li>
                );
              })}
            </ul>
          )}
          {attributions && needsTmdbNotice(attributions) ? <p className="mt-4 text-sm text-muted">{TMDB_NOTICE}</p> : null}
        </section>

        <section aria-labelledby="scores-heading">
          <h2 id="scores-heading" className="display text-3xl">
            How scores work
          </h2>
          <div className="mt-3 max-w-prose space-y-3">
            <p>
              A score labelled with a data source&apos;s name, such as <em>Score on MyAnimeList</em>, comes from that source. Storyverse X
              shows it as it was fetched and does not adjust it.
            </p>
            <p>
              The score labelled <em>Storyverse members</em> is made of ratings from 1 to 10 given by people with an account here. It is a
              plain average, shown with the number of ratings behind it, and it is never mixed with a source score.
            </p>
            <p>
              The <strong className="font-semibold">Highest rated</strong> lists and the &ldquo;Highest rated&rdquo; sort use a weighted score so a
              handful of perfect ratings cannot outrank a title that thousands of people scored a little lower. The weighted score is{' '}
              <span className="tnum">(v × R + m × C) ÷ (v + m)</span>, where R is the source score, v is how many ratings it has, C is
              6.5 and m is 100. A title with few ratings is pulled toward 6.5, and one with many keeps nearly its own score.
            </p>
          </div>
        </section>

        <section aria-labelledby="similar-heading">
          <h2 id="similar-heading" className="display text-3xl">
            Similar titles
          </h2>
          <p className="mt-3 max-w-prose">
            The similar titles on a title page are the ones that share the most genres and themes with it. That is a simple content match.
            It does not learn from what you read or watch, and it is not a personal recommendation.
          </p>
        </section>

        <section aria-labelledby="privacy-heading">
          <h2 id="privacy-heading" className="display text-3xl">
            Your data
          </h2>
          <div className="mt-3 max-w-prose space-y-3">
            <p>
              An account stores your email address, a username, an optional display name and bio, and your library: the titles you add, your
              progress, ratings and notes.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Profiles are public by default, and you can make yours private in settings.</li>
              <li>
                Someone else can see a library entry only when your profile is public and you have not marked that entry private.
              </li>
              <li>Your notes are visible only to you.</li>
              <li>Ratings on a private entry still count in the community average, but they are not tied to your name.</li>
              <li>You can download your data or delete your account at any time in settings. Deleting removes your profile, library and ratings.</li>
              <li>The site sets a sign-in cookie when you sign in. It uses no analytics and no advertising trackers.</li>
            </ul>
            <p>
              <Link href="/signup" className="link">
                Create an account
              </Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
