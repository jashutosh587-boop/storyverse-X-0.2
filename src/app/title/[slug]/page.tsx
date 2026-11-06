import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LibraryControl } from '@/components/library-control';
import { Poster } from '@/components/poster';
import { SetupRequired } from '@/components/states';
import { Credits } from '@/components/title/credits';
import { RelationThread } from '@/components/title/relations';
import { Scores } from '@/components/title/scores';
import { Sources } from '@/components/title/sources';
import { WatchExperience } from '@/components/title/watch-experience';
import { TitleGrid } from '@/components/title-card';
import { getSimilarTitles } from '@/lib/api/catalog';
import { getWatchCatalog } from '@/lib/api/watch';
import { getLibraryEntry } from '@/lib/api/library';
import type { LibraryEntry } from '@/lib/api/schemas';
import { categoryForMediaType } from '@/lib/categories';
import { getBackend, getCurrentUser, loadTitle } from '@/lib/data';
import {
  formatDate,
  formatRuntime,
  inSentence,
  languageName,
  MEDIA_LABEL,
  regionName,
  statusLabel,
  unitLabel,
} from '@/lib/format';
import { isAllowedImage } from '@/lib/image-hosts';

type Props = { params: Promise<{ slug: string }> };

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const detail = await loadTitle(slug).catch(() => null);
  if (!detail) return {};
  const { title } = detail;
  const description = title.synopsis
    ? clip(title.synopsis, 160)
    : `${MEDIA_LABEL[title.media_type]}${title.release_year ? `, ${title.release_year}` : ''}.`;
  return {
    title: title.title,
    description,
    alternates: { canonical: `/title/${title.slug}` },
    openGraph: {
      title: title.title,
      description,
      type: 'website',
      images: isAllowedImage(title.poster_url) ? [title.poster_url] : undefined,
    },
  };
}

export default async function TitlePage({ params }: Props) {
  const { slug } = await params;
  const backend = await getBackend();
  if (!backend.ok) return <SetupRequired problems={backend.problems} />;

  const detail = await loadTitle(slug);
  if (!detail) notFound();
  const { title, alt_names: altNames, contributors, sources, relations, community } = detail;

  const user = await getCurrentUser();
  const [similar, entryResult, watchCatalog] = await Promise.all([
    getSimilarTitles(backend.supabase, title.id, 12).catch(() => []),
    user
      ? getLibraryEntry(backend.supabase, title.id).then(
          (entry): { entry: LibraryEntry | null } | { failed: true } => ({ entry }),
          (): { failed: true } => ({ failed: true }),
        )
      : Promise.resolve(null),
    title.media_type === 'anime' ? getWatchCatalog(backend.supabase, title.id).catch(() => null) : Promise.resolve(null),
  ]);

  const category = categoryForMediaType(title.media_type);
  const here = `/title/${title.slug}`;
  const backdrop = isAllowedImage(title.backdrop_url) ? title.backdrop_url : null;

  const knownAs = altNames
    .map((a) => a.name)
    .filter((name, i, all) => name !== title.title && name !== title.title_original && all.indexOf(name) === i);

  const amount = (n: number | null, unit: string) => (n === null ? null : `${n.toLocaleString('en-US')} ${unitLabel(unit, n)}`);
  const facts: Array<[string, string | null]> = [
    ['Type', title.format && title.format !== MEDIA_LABEL[title.media_type] ? `${MEDIA_LABEL[title.media_type]}, ${title.format}` : MEDIA_LABEL[title.media_type]],
    ['Status', statusLabel(title.status)],
    ['Released', formatDate(title.release_date) ?? (title.release_year ? String(title.release_year) : null)],
    ['Ended', formatDate(title.end_date)],
    ['Season', title.season ? `${title.season.charAt(0).toUpperCase()}${title.season.slice(1)}${title.season_year ? ` ${title.season_year}` : ''}` : null],
    ['Episodes', amount(title.episodes, 'episodes')],
    ['Chapters', amount(title.chapters, 'chapters')],
    ['Volumes', amount(title.volumes, 'volumes')],
    ['Pages', amount(title.pages, 'pages')],
    ['Runtime', title.runtime_minutes ? formatRuntime(title.runtime_minutes) : null],
    ['Country', title.country ? regionName(title.country) : null],
    ['Language', title.language ? languageName(title.language) : null],
    ['Age rating', title.age_rating],
  ];
  const shownFacts = facts.filter((fact): fact is [string, string] => fact[1] !== null);

  return (
    <article className="relative">
      {backdrop ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-80 overflow-hidden">
          <Image src={backdrop} alt="" fill sizes="100vw" priority className="object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-b from-ink/0 via-ink/70 to-ink" />
        </div>
      ) : null}

      <div className="shell relative py-8 md:py-10">
        {category ? (
          <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
            <ol className="flex flex-wrap gap-x-2">
              <li>
                <Link href={`/${category.slug}`} className="hover:text-text">
                  {category.label}
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="min-w-0 max-w-full truncate text-text">
                {title.title}
              </li>
            </ol>
          </nav>
        ) : null}

        <header className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-5 gap-y-6 sm:grid-cols-[10rem_minmax(0,1fr)] md:gap-x-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="md:row-span-2">
            <Poster title={title.title} url={title.poster_url} mediaType={title.media_type} sizes="(min-width: 1024px) 224px, (min-width: 640px) 160px, 112px" priority />
          </div>

          <div className="min-w-0">
            <h1 className="display text-4xl sm:text-5xl lg:text-6xl">{title.title}</h1>
            {title.title_original && title.title_original !== title.title ? (
              <p lang={title.language ?? undefined} className="mt-1 text-lg text-muted">
                {title.title_original}
              </p>
            ) : null}
            <p className="mt-2 text-muted">
              {MEDIA_LABEL[title.media_type]}
              {title.release_year ? `, ${title.release_year}` : ''}
              {title.status !== 'unknown' ? `, ${statusLabel(title.status).toLowerCase()}` : ''}
            </p>

            {title.genres.length > 0 ? (
              <ul aria-label="Genres" className="mt-4 flex flex-wrap gap-2">
                {title.genres.map((genre) => (
                  <li key={genre}>
                    {category ? (
                      <Link href={`/${category.slug}?genre=${encodeURIComponent(genre)}`} className="chip">
                        {genre}
                      </Link>
                    ) : (
                      <span className="chip">{genre}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="col-span-2 min-w-0 md:col-span-1 md:col-start-2 md:self-end">
            <Scores title={title} community={community} />
          </div>
        </header>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-14">
          <div className="min-w-0 space-y-12">
            {title.media_type === 'anime' ? (
              watchCatalog ? (
                <WatchExperience
                  titleId={title.id}
                  title={title.title}
                  slug={title.slug}
                  catalog={watchCatalog}
                  isSignedIn={Boolean(user)}
                />
              ) : (
                <section className="panel" aria-labelledby="watch-heading">
                  <h2 id="watch-heading" className="display text-3xl">Watch {title.title}</h2>
                  <p className="mt-2 text-sm text-muted">The streaming feature needs the latest Storyverse X watch-catalogue database migration. Catalogue information remains available below.</p>
                </section>
              )
            ) : null}

            <section aria-labelledby="synopsis-heading">
              <h2 id="synopsis-heading" className="display text-3xl">
                Synopsis
              </h2>
              {title.synopsis ? (
                <div className="mt-3 max-w-prose space-y-3 leading-relaxed">
                  {title.synopsis.split(/\n{2,}/).map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-muted">The data sources do not provide a synopsis for this title.</p>
              )}
            </section>

            <section aria-labelledby="facts-heading">
                <h2 id="facts-heading" className="display text-3xl">
                  Details
                </h2>
                <dl className="mt-4 grid max-w-xl grid-cols-[8rem_1fr] gap-x-6 gap-y-2">
                  {shownFacts.map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-muted">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                  {knownAs.length > 0 ? (
                    <div className="contents">
                      <dt className="text-muted">Also known as</dt>
                      <dd>
                        {knownAs.slice(0, 4).join(', ')}
                        {knownAs.length > 4 ? (
                          <details className="mt-1">
                            <summary className="link cursor-pointer text-sm">Show {knownAs.length - 4} more</summary>
                            <p className="mt-1">{knownAs.slice(4).join(', ')}</p>
                          </details>
                        ) : null}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {title.themes.length > 0 ? (
                  <>
                    <h3 className="mt-6 text-sm font-semibold">Themes</h3>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {title.themes.map((theme) => (
                        <li key={theme} className="chip">
                          {theme}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
            </section>

            <Credits credits={contributors} />
            <RelationThread relations={relations} />

            {similar.length > 0 ? (
              <section aria-labelledby="similar-heading">
                <h2 id="similar-heading" className="display text-3xl">
                  Similar titles
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Matched on shared genres and themes. This is a simple content match, not a personal recommendation.
                </p>
                <div className="mt-5">
                  <TitleGrid
                    label="Similar titles"
                    titles={similar.map((s) => ({ ...s, note: `Shares ${s.shared_tags.slice(0, 3).join(', ')}` }))}
                  />
                </div>
              </section>
            ) : null}

            <Sources sources={sources} />
          </div>

          <aside aria-label="Your library" className="order-first lg:sticky lg:top-6 lg:order-none lg:self-start">
            {!user ? (
              <section className="panel">
                <h2 className="text-lg font-semibold">Keep track of this {inSentence(MEDIA_LABEL[title.media_type])}</h2>
                <p className="mt-2 text-muted">Build a library, log how far you have got and rate what you finish.</p>
                <div className="mt-4 flex flex-col gap-2">
                  <Link href={`/signup?next=${encodeURIComponent(here)}`} className="btn btn-primary">
                    Create an account
                  </Link>
                  <Link href={`/login?next=${encodeURIComponent(here)}`} className="btn btn-quiet">
                    Sign in
                  </Link>
                </div>
              </section>
            ) : entryResult && 'failed' in entryResult ? (
              <section className="panel">
                <h2 className="text-lg font-semibold">Your library</h2>
                <p role="alert" className="mt-2 text-bad">
                  We could not load your library entry for this title, so the form is hidden to keep it from overwriting anything. Reload the
                  page to try again.
                </p>
              </section>
            ) : (
              <LibraryControl
                titleId={title.id}
                slug={title.slug}
                mediaType={title.media_type}
                entry={entryResult?.entry ?? null}
                progressUnit={title.progress_unit}
                progressTotal={title.progress_total}
              />
            )}
          </aside>
        </div>
      </div>
    </article>
  );
}
