'use client';

import { useActionState } from 'react';
import { removeLibraryAction, saveLibraryAction, type LibraryFormState } from '@/app/actions/library';
import { LIBRARY_STATUSES, type LibraryEntry } from '@/lib/api/schemas';
import { libraryStatusLabel, unitLabel } from '@/lib/format';
import type { MediaType } from '@/lib/providers/types';
import { SubmitButton } from './submit-button';

const idle: LibraryFormState = { status: 'idle' };

/**
 * Add a title to your library, then track how far you are, rate it and keep
 * private notes. The database enforces the rules (progress cannot pass the
 * total, finishing sets progress to the total); this form only asks nicely.
 */
export function LibraryControl({
  titleId,
  slug,
  mediaType,
  entry,
  progressUnit,
  progressTotal,
}: {
  titleId: string;
  slug: string;
  mediaType: MediaType;
  entry: LibraryEntry | null;
  progressUnit: string | null;
  progressTotal: number | null;
}) {
  const [saveState, saveAction] = useActionState(saveLibraryAction, idle);
  const [removeState, removeAction] = useActionState(removeLibraryAction, idle);
  const hasProgress = progressUnit !== null && progressUnit !== 'viewing';
  const message = [saveState, removeState]
    .filter((s): s is Exclude<LibraryFormState, { status: 'idle' }> => s.status !== 'idle')
    .sort((a, b) => b.at - a.at)[0];

  return (
    <section aria-labelledby="library-heading" className="panel">
      <h2 id="library-heading" className="text-lg font-semibold">
        {entry ? 'In your library' : 'Add to your library'}
      </h2>

      {/* Remounted when the saved entry changes, so the fields show what the database kept. */}
      <form key={entry?.updated_at ?? 'new'} action={saveAction} className="mt-4 space-y-4">
        <input type="hidden" name="titleId" value={titleId} />
        <input type="hidden" name="slug" value={slug} />

        <div>
          <label htmlFor="lib-status" className="label">
            Status
          </label>
          <select id="lib-status" name="status" defaultValue={entry?.status ?? 'planned'} className="field">
            {LIBRARY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {libraryStatusLabel(status, mediaType)}
              </option>
            ))}
          </select>
        </div>

        {hasProgress ? (
          <div>
            <label htmlFor="lib-progress" className="label">
              Progress{progressUnit ? `, in ${unitLabel(progressUnit, 2)}` : ''}
            </label>
            <input
              id="lib-progress"
              name="progress"
              type="number"
              inputMode="numeric"
              min={0}
              max={progressTotal ?? undefined}
              step={1}
              defaultValue={entry?.progress ?? 0}
              className="field"
            />
            <p className="hint">
              {progressTotal !== null
                ? `This title has ${progressTotal} ${unitLabel(progressUnit, progressTotal)}.`
                : `The total is not known yet, so any number is accepted.`}
            </p>
          </div>
        ) : null}

        <div>
          <label htmlFor="lib-rating" className="label">
            Your rating
          </label>
          <select id="lib-rating" name="rating" defaultValue={entry?.rating?.toString() ?? ''} className="field">
            <option value="">Not rated</option>
            {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} out of 10
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="lib-notes" className="label">
            Private notes
          </label>
          <textarea id="lib-notes" name="notes" maxLength={2000} defaultValue={entry?.notes ?? ''} className="field" />
          <p className="hint">Only you can see your notes.</p>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="isPrivate" defaultChecked={entry?.is_private ?? false} className="mt-1 size-4 accent-[var(--color-violet)]" />
          <span>
            Keep this entry private
            <span className="block text-muted">It will not show on your public profile. It still counts in the community rating.</span>
          </span>
        </label>

        <SubmitButton pendingLabel="Saving…" className="btn btn-primary w-full">
          {entry ? 'Save changes' : 'Add to library'}
        </SubmitButton>
      </form>

      {entry ? (
        <form action={removeAction} className="mt-3">
          <input type="hidden" name="titleId" value={titleId} />
          <input type="hidden" name="slug" value={slug} />
          <SubmitButton pendingLabel="Removing…" className="btn btn-danger w-full">
            Remove from library
          </SubmitButton>
        </form>
      ) : null}

      <p role="status" aria-live="polite" className={`mt-3 text-sm ${message?.status === 'error' ? 'text-bad' : 'text-good'}`}>
        {message?.message ?? ''}
      </p>
    </section>
  );
}
