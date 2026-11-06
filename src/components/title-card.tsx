import Link from 'next/link';
import type { TitleCard as TitleCardData } from '@/lib/api/schemas';
import { formatScore, formatScoreShort, MEDIA_LABEL } from '@/lib/format';
import { Poster } from './poster';

const SIZES = '(min-width: 1024px) 15vw, (min-width: 768px) 22vw, 45vw';

export function TitleCard({ title, note, priority = false }: { title: TitleCardData; note?: string; priority?: boolean }) {
  const score = title.provider_score;
  return (
    <li>
      <Link href={`/title/${title.slug}`} className="group block">
        <div className="relative">
          <Poster title={title.title} url={title.poster_url} mediaType={title.media_type} sizes={SIZES} priority={priority} />
          {score !== null && (
            <span className="tnum absolute left-1.5 top-1.5 rounded bg-ink/90 px-1.5 py-0.5 text-xs font-semibold text-sky">
              <span aria-hidden="true">{formatScoreShort(score)}</span>
              <span className="sr-only">
                {title.provider_score_source ?? 'Provider'} score {formatScore(score)} out of 10
              </span>
            </span>
          )}
        </div>
        <p className="mt-2 line-clamp-2 text-[0.95rem] font-medium leading-snug group-hover:text-violet-soft">{title.title}</p>
        <p className="text-sm text-muted">
          {MEDIA_LABEL[title.media_type]}
          {title.release_year ? `, ${title.release_year}` : ''}
        </p>
        {note ? <p className="mt-0.5 line-clamp-2 text-xs text-muted">{note}</p> : null}
      </Link>
    </li>
  );
}

export function TitleGrid({ titles, label }: { titles: Array<TitleCardData & { note?: string }>; label: string }) {
  return (
    <ul aria-label={label} className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {titles.map((title, index) => (
        <TitleCard key={title.id} title={title} note={title.note} priority={index < 6} />
      ))}
    </ul>
  );
}
