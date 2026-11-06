'use client';

import { useActionState } from 'react';
import { deleteAccountAction, updateProfileAction, type ProfileFormState } from '@/app/actions/profile';
import type { Profile } from '@/lib/api/schemas';
import { SubmitButton } from './submit-button';

const idle: ProfileFormState = { status: 'idle' };

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action] = useActionState(updateProfileAction, idle);
  const error = state.status === 'error' ? state : null;

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="p-username" className="label">
          Username
        </label>
        <input
          id="p-username"
          name="username"
          required
          defaultValue={profile.username}
          autoComplete="username"
          aria-invalid={error?.field === 'username' ? true : undefined}
          aria-describedby={error?.field === 'username' ? 'p-username-error' : 'p-username-hint'}
          className="field"
        />
        {error?.field === 'username' ? (
          <p id="p-username-error" className="error-text mt-1.5">
            {error.message}
          </p>
        ) : (
          <p id="p-username-hint" className="hint">
            Your profile lives at /u/{profile.username}. Changing it changes that address.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="p-name" className="label">
          Display name
        </label>
        <input id="p-name" name="displayName" defaultValue={profile.display_name ?? ''} maxLength={60} className="field" />
        {error?.field === 'displayName' ? <p className="error-text mt-1.5">{error.message}</p> : null}
      </div>

      <div>
        <label htmlFor="p-bio" className="label">
          Bio
        </label>
        <textarea id="p-bio" name="bio" defaultValue={profile.bio ?? ''} maxLength={500} className="field" />
        {error?.field === 'bio' ? <p className="error-text mt-1.5">{error.message}</p> : null}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="isPublic" defaultChecked={profile.is_public} className="mt-1 size-4 accent-[var(--color-violet)]" />
        <span>
          Public profile
          <span className="block text-muted">
            Anyone can see your username, bio and the library entries you have not marked private. Turn this off to hide all of it.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-4">
        <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
        <p role="status" aria-live="polite" className={`text-sm ${state.status === 'error' ? 'text-bad' : 'text-good'}`}>
          {state.status === 'saved' ? state.message : state.status === 'error' && !state.field ? state.message : ''}
        </p>
      </div>
    </form>
  );
}

export function DeleteAccountForm({ username }: { username: string }) {
  const [state, action] = useActionState(deleteAccountAction, idle);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="d-confirm" className="label">
          Type your username, {username}, to confirm
        </label>
        <input id="d-confirm" name="confirm" required autoComplete="off" className="field" />
        {state.status === 'error' ? (
          <p role="alert" className="error-text mt-1.5">
            {state.message}
          </p>
        ) : null}
      </div>
      <SubmitButton pendingLabel="Deleting…" className="btn btn-danger">
        Delete my account permanently
      </SubmitButton>
    </form>
  );
}
