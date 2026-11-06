import Link from 'next/link';
import type { TitleDetail } from '@/lib/api/schemas';
import { inSentence, MEDIA_LABEL, relationLabel } from '@/lib/format';

/**
 * How this title connects to others, drawn as a thread. A filled dot is a title
 * in the catalog (a link); a hollow dot is one a provider says is related that
 * has not been imported yet, so it is named but cannot be opened.
 */
export function RelationThread({ relations }: { relations: TitleDetail['relations'] }) {
  if (relations.length === 0) return null;

  const groups: Array<{ relation: string; items: TitleDetail['relations'] }> = [];
  for (const item of relations) {
    const last = groups.at(-1);
    if (last && last.relation === item.relation) last.items.push(item);
    else groups.push({ relation: item.relation, items: [item] });
  }

  return (
    <section aria-labelledby="relations-heading">
      <h2 id="relations-heading" className="display text-3xl">
        Connected stories
      </h2>
      <p className="mt-1 text-sm text-muted">Sequels, adaptations and spin-offs, as recorded by the data sources.</p>
      <div className="mt-5 space-y-6">
        {groups.map((group) => (
          <div key={group.relation}>
            <h3 className="text-sm font-semibold">{relationLabel(group.relation)}</h3>
            <ul className="mt-2 border-l border-line-strong">
              {group.items.map(({ title }) => (
                <li key={title.id} className="relative py-1.5 pl-5">
                  <span
                    aria-hidden="true"
                    className={`absolute -left-[5px] top-[1.1rem] size-[9px] rounded-full ${
                      title.is_stub ? 'border border-line-strong bg-ink' : 'bg-violet'
                    }`}
                  />
                  {title.is_stub ? (
                    <p>
                      {title.title}
                      <span className="text-sm text-muted">, {inSentence(MEDIA_LABEL[title.media_type])}, not in the catalog yet</span>
                    </p>
                  ) : (
                    <Link href={`/title/${title.slug}`} className="group">
                      <span className="group-hover:text-violet-soft">{title.title}</span>
                      <span className="text-sm text-muted">
                        , {inSentence(MEDIA_LABEL[title.media_type])}
                        {title.release_year ? `, ${title.release_year}` : ''}
                      </span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
