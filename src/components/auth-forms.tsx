'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { requestPasswordResetAction, signInAction, signUpAction, updatePasswordAction, type AuthFormState } from '@/app/actions/auth';
import { SubmitButton } from './submit-button';

const initial: AuthFormState = {};

function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  defaultValue,
  error,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete: string;
  defaultValue?: string;
  error?: string;
  hint?: string;
}) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  return (
    <div>
      <label htmlFor={name} className="label">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined}
        className="field"
      />
      {hint && !error ? (
        <p id={hintId} className="hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="error-text mt-1.5">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="notice notice-error text-sm">
      {message}
    </p>
  );
}

export function SignInForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInAction, initial);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormError message={state.error} />
      <Field label="Email address" name="email" type="email" autoComplete="email" defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" error={state.fieldErrors?.password} />
      <p className="text-sm">
        <Link href="/forgot-password" className="link">
          Forgot your password?
        </Link>
      </p>
      <SubmitButton pendingLabel="Signing in…" className="btn btn-primary w-full">
        Sign in
      </SubmitButton>
    </form>
  );
}

export function SignUpForm({ next }: { next: string }) {
  const [state, action] = useActionState(signUpAction, initial);

  if (state.checkEmail) {
    return (
      <div role="status" className="notice">
        <p className="font-medium">Check your email</p>
        <p className="mt-1 text-sm text-muted">
          We sent a confirmation link to {state.values?.email}. Open it to finish creating your account, then sign in.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormError message={state.error} />
      <Field label="Email address" name="email" type="email" autoComplete="email" defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      <Field
        label="Username"
        name="username"
        autoComplete="username"
        defaultValue={state.values?.username}
        error={state.fieldErrors?.username}
        hint="3 to 24 letters, numbers or underscores. This is public."
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        error={state.fieldErrors?.password}
        hint="At least 8 characters."
      />
      <SubmitButton pendingLabel="Creating account…" className="btn btn-primary w-full">
        Create account
      </SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, initial);

  if (state.checkEmail) {
    return (
      <div role="status" className="notice">
        <p className="font-medium">Check your email</p>
        <p className="mt-1 text-sm text-muted">
          If an account exists for {state.values?.email}, we sent a link to choose a new password. Open it in this browser. If nothing arrives in a few
          minutes, check your spam folder.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError message={state.error} />
      <Field label="Email address" name="email" type="email" autoComplete="email" defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      <SubmitButton pendingLabel="Sending…" className="btn btn-primary w-full">
        Email me a reset link
      </SubmitButton>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action] = useActionState(updatePasswordAction, initial);

  if (state.done) {
    return (
      <div role="status" className="notice">
        <p className="font-medium">Password changed</p>
        <p className="mt-1 text-sm text-muted">You are signed in with your new password.</p>
        <Link href="/" className="btn btn-primary mt-4">
          Go to the home page
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError message={state.error} />
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        error={state.fieldErrors?.password}
        hint="At least 8 characters."
      />
      <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" error={state.fieldErrors?.confirm} />
      <SubmitButton pendingLabel="Saving…" className="btn btn-primary w-full">
        Save new password
      </SubmitButton>
    </form>
  );
}
