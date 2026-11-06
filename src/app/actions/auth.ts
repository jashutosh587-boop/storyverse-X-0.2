'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isUsernameAvailable } from '@/lib/api/profile';
import { describeAuthFailure } from '@/lib/auth-errors';
import { getBackend, getCurrentUser } from '@/lib/data';
import { siteOrigin } from '@/lib/origin';
import { safeNext } from '@/lib/safe-next';

export interface AuthFormState {
  error?: string;
  fieldErrors?: Partial<Record<'email' | 'password' | 'confirm' | 'username', string>>;
  /** An email was sent: after sign-up when the project requires the address to be confirmed, and after a password reset request. */
  checkEmail?: boolean;
  /** The new password was saved. */
  done?: boolean;
  values?: { email?: string; username?: string };
}

const email = z.string().trim().toLowerCase().min(1, 'Enter your email address.').max(254).email('Enter a valid email address.');
// 72 is the longest password the auth service accepts.
const newPassword = z.string().min(8, 'Use at least 8 characters.').max(72, 'Use 72 characters or fewer.');
const username = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{3,24}$/, 'Use 3 to 24 letters, numbers or underscores.');

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

function flatten(error: z.ZodError): AuthFormState['fieldErrors'] {
  const out: NonNullable<AuthFormState['fieldErrors']> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if ((key === 'email' || key === 'password' || key === 'confirm' || key === 'username') && !out[key]) out[key] = issue.message;
  }
  return out;
}

const notConfigured: AuthFormState = { error: 'This site is not connected to its database yet, so accounts are unavailable.' };

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = z.object({ email, password: z.string().min(1, 'Enter your password.').max(200) }).safeParse({
    email: text(formData, 'email'),
    password: text(formData, 'password'),
  });
  const values = { email: text(formData, 'email').trim() };
  if (!parsed.success) return { fieldErrors: flatten(parsed.error), values };

  const backend = await getBackend();
  if (!backend.ok) return notConfigured;

  const { error } = await backend.supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ...describeAuthFailure(error, 'sign-in'), values };
  redirect(safeNext(formData.get('next'), '/'));
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = z.object({ email, password: newPassword, username }).safeParse({
    email: text(formData, 'email'),
    password: text(formData, 'password'),
    username: text(formData, 'username'),
  });
  const values = { email: text(formData, 'email').trim(), username: text(formData, 'username').trim() };
  if (!parsed.success) return { fieldErrors: flatten(parsed.error), values };

  const backend = await getBackend();
  if (!backend.ok) return notConfigured;

  try {
    if (!(await isUsernameAvailable(backend.supabase, parsed.data.username))) {
      return { fieldErrors: { username: 'That username is taken. Try another.' }, values };
    }
  } catch {
    return { error: 'Sign-up is unavailable right now. Try again in a moment.', values };
  }

  const siteUrl = await siteOrigin();
  const { data, error } = await backend.supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { username: parsed.data.username },
      emailRedirectTo: `${siteUrl}/auth/callback`,
    },
  });

  if (error) return { ...describeAuthFailure(error, 'sign-up'), values };
  if (data.session) redirect(safeNext(formData.get('next'), '/'));
  return { checkEmail: true, values };
}

export async function signOutAction(): Promise<void> {
  const backend = await getBackend();
  // Only this browser. The default would also end the member's sessions on every other device.
  if (backend.ok) await backend.supabase.auth.signOut({ scope: 'local' });
  redirect('/');
}

export async function requestPasswordResetAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = z.object({ email }).safeParse({ email: text(formData, 'email') });
  const values = { email: text(formData, 'email').trim() };
  if (!parsed.success) return { fieldErrors: flatten(parsed.error), values };

  const backend = await getBackend();
  if (!backend.ok) return notConfigured;

  const siteUrl = await siteOrigin();
  const { error } = await backend.supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${siteUrl}/auth/recovery` });
  if (error) {
    const failure = describeAuthFailure(error, 'reset-request');
    if (failure.error || failure.fieldErrors) return { ...failure, values };
  }
  // The same answer whether or not the address has an account, so the form cannot be used to find out who does.
  return { checkEmail: true, values };
}

export async function updatePasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = z
    .object({ password: newPassword, confirm: z.string() })
    .refine((value) => value.password === value.confirm, { path: ['confirm'], message: 'The two passwords do not match.' })
    .safeParse({ password: text(formData, 'password'), confirm: text(formData, 'confirm') });
  if (!parsed.success) return { fieldErrors: flatten(parsed.error) };

  const backend = await getBackend();
  if (!backend.ok) return notConfigured;
  if (!(await getCurrentUser())) return describeAuthFailure({ name: 'AuthSessionMissingError' }, 'new-password');

  const { error } = await backend.supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return describeAuthFailure(error, 'new-password');
  return { done: true };
}
