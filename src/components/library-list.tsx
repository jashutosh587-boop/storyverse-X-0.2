import Link from 'next/link';
import type { LibraryList as LibraryListData } from '@/lib/api/schemas';
import { libraryStatusLabel, MEDIA_LABEL, unitLabel } from '@/lib/format';
import { Poster } from './poster';

/** A list of library entries. Notes are only present when the viewer owns the entry (the database removes them otherwise). */
export function LibraryList({ items }: { items: LibraryListData['items'] }) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {items.map(({ entry, title, progress_unit: unit, progress_total: total }) => {
        // A title that is only planned has nothing to report yet, so "0 chapters" would be noise.
        const tracksProgress = unit !== null && unit !== 'viewing' && !(entry.status === 'planned' && entry.progress === 0);
        return (
          <li key={title.id} className="grid grid-cols-[3.5rem_1fr] gap-x-4 gap-y-2 py-4 sm:grid-cols-[3.5rem_1fr_auto]">
            <Link href={`/title/${title.slug}`} tabIndex={-1} aria-hidden="true">
              <Poster title={title.title} url={title.poster_url} mediaType={title.media_type} sizes="56px" />
            </Link>

            <div className="min-w-0">
              <Link href={`/title/${title.slug}`} className="font-medium hover:text-violet-soft">
                {title.title}
              </Link>
              <p className="text-sm text-muted">
                {MEDIA_LABEL[title.media_type]}
                {title.release_year ? `, ${title.release_year}` : ''}
              </p>

              {tracksProgress ? (
                <div className="mt-2 max-w-xs">
                  <p className="tnum text-sm">
                    {entry.progress}
                    {total !== null ? ` of ${total}` : ''} {unitLabel(unit, total ?? entry.progress)}
                  </p>
                  {total !== null && total > 0 ? (
                    <progress className="meter mt-1" max={total} value={entry.progress} aria-label={`Progress on ${title.title}`} />
                  ) : null}
                </div>
              ) : null}

              {entry.notes ? <p className="mt-2 max-w-prose text-sm text-muted">{entry.notes}</p> : null}
            </div>

            <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:flex-col sm:items-end sm:justify-start">
              <span className="chip">{libraryStatusLabel(entry.status, title.media_type)}</span>
              {entry.rating !== null ? (
                <span className="tnum text-sm">
                  <span className="text-violet-soft">{entry.rating}</span>
                  <span className="text-muted"> out of 10</span>
                </span>
              ) : null}
              {entry.is_private ? <span className="text-xs text-muted">Private</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
