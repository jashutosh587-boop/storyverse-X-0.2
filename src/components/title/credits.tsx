import { Fragment } from 'react';
import type { TitleDetail } from '@/lib/api/schemas';
import { groupCredits } from '@/lib/format';

const SHOWN = 10;

/** Studios, authors, directors and cast, grouped by role. Long lists fold away after the first ten. */
export function Credits({ credits }: { credits: TitleDetail['contributors'] }) {
  const groups = groupCredits(credits);
  if (groups.length === 0) return null;

  return (
    <section aria-labelledby="credits-heading">
      <h2 id="credits-heading" className="display text-3xl">
        Credits
      </h2>
      <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-[9rem_1fr]">
        {groups.map(({ role, items }) => {
          const names = items.map((c) => c.name);
          const rest = names.slice(SHOWN);
          return (
            <Fragment key={role}>
              <dt className="text-muted">{role}</dt>
              <dd>
                {names.slice(0, SHOWN).join(', ')}
                {rest.length > 0 ? (
                  <details className="mt-1">
                    <summary className="link cursor-pointer text-sm">Show {rest.length} more</summary>
                    <p className="mt-1">{rest.join(', ')}</p>
                  </details>
                ) : null}
              </dd>
            </Fragment>
          );
        })}
      </dl>
    </section>
  );
}
