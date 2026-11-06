/**
 * What a visitor is told when the sign-in service refuses a request or cannot be
 * reached. The codes are the ones Supabase Auth (GoTrue) returns.
 *
 * Two rules shape the wording: a message must never confirm that an address has
 * an account, and it must say what to do next.
 */

export type AuthIntent = 'sign-in' | 'sign-up' | 'reset-request' | 'new-password';

/** The parts of an auth-js error used here, so tests can hand in plain objects. */
export interface AuthFailureInput {
  name?: string;
  code?: string;
  status?: number;
}

export interface AuthFailure {
  /** For the whole form. */
  error?: string;
  /** For a single field. */
  fieldErrors?: { email?: string; password?: string };
}

const TRY_AGAIN = 'Try again in a moment.';

const UNAVAILABLE: Record<AuthIntent, string> = {
  'sign-in': `Sign-in is unavailable right now. ${TRY_AGAIN}`,
  'sign-up': `Sign-up is unavailable right now. ${TRY_AGAIN}`,
  'reset-request': `We could not send the email just now. ${TRY_AGAIN}`,
  'new-password': `We could not save your new password just now. ${TRY_AGAIN}`,
};

const RATE_LIMITED = new Set(['over_email_send_rate_limit', 'over_request_rate_limit', 'over_sms_send_rate_limit']);

/** The visitor's sign-in no longer works, so only a new reset link can help. */
const SESSION_GONE = new Set(['session_expired', 'session_not_found', 'bad_jwt', 'user_not_found', 'refresh_token_not_found', 'refresh_token_already_used']);

/** The project asks for more proof than a signed-in session before it changes a password. */
const NEEDS_NEW_LINK = new Set(['reauthentication_needed', 'reauthentication_not_valid', 'current_password_required', 'current_password_invalid']);

/**
 * The service could not be reached, or failed on its own side. Nothing the visitor
 * typed can cause this, so it must never be reported as a wrong password.
 * (A network failure has status 0, which is why a status check alone misses it.)
 */
export function isOutage(error: AuthFailureInput): boolean {
  return (
    error.name === 'AuthRetryableFetchError' ||
    error.name === 'AuthUnknownError' ||
    (typeof error.status === 'number' && error.status >= 500)
  );
}

export function describeAuthFailure(error: AuthFailureInput, intent: AuthIntent): AuthFailure {
  const code = error.code ?? '';

  // The sending limit is kept per address, and the service applies it only to addresses that have an account. Reporting it
  // would tell anyone who asks which addresses are registered, so a reset request carries on as if it had been accepted.
  if (intent === 'reset-request' && code === 'over_email_send_rate_limit') return {};

  if (isOutage(error)) return { error: UNAVAILABLE[intent] };
  if (error.status === 429 || RATE_LIMITED.has(code)) return { error: 'Too many attempts. Wait a few minutes and try again.' };

  switch (intent) {
    case 'sign-in':
      if (code === 'email_not_confirmed') {
        return {
          error:
            'Confirm your email address first. The link is in the message we sent when you signed up. If it has expired, choose “Forgot your password?” to get a new one.',
        };
      }
      if (code === 'user_banned') return { error: 'This account cannot sign in right now.' };
      // One message for a wrong password and an unknown address, so the form cannot be used to find out who has an account.
      return { error: 'The email address or password is not right.' };

    case 'sign-up':
      if (code === 'weak_password') return { fieldErrors: { password: 'Choose a stronger password.' } };
      if (code === 'email_address_invalid' || code === 'email_address_not_authorized') {
        return { fieldErrors: { email: 'That email address cannot be used here.' } };
      }
      if (code === 'signup_disabled') return { error: 'New accounts cannot be created right now.' };
      return { error: 'We could not create that account. If you already have one, sign in instead.' };

    case 'reset-request':
      // Anything else (such as the project being unable to send mail) is the site's problem, not the address's.
      return { error: UNAVAILABLE['reset-request'] };

    case 'new-password':
      if (code === 'same_password') return { fieldErrors: { password: 'That is your current password. Choose a different one.' } };
      if (code === 'weak_password') return { fieldErrors: { password: 'Choose a stronger password.' } };
      if (NEEDS_NEW_LINK.has(code)) {
        return { error: 'For your security, a password can only be changed with a fresh reset link. Sign out, then choose “Forgot your password?” on the sign-in page.' };
      }
      if (SESSION_GONE.has(code) || error.name === 'AuthSessionMissingError' || error.status === 401) {
        return { error: 'Your reset link has expired or was already used. Go back to “Forgot your password?” for a new one.' };
      }
      return { error: 'We could not save that password. Try again, or ask for a new reset link.' };
  }
}
