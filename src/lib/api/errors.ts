/**
 * Errors the database functions raise on purpose (see supabase/migrations), plus
 * the two that come from outside them. Anything else is reported as "unavailable"
 * so raw database messages never reach a visitor.
 */
export const API_ERROR_CODES = [
  'not_authenticated',
  'title_not_found',
  'invalid_status',
  'invalid_progress',
  'progress_exceeds_total',
  'invalid_rating',
  'invalid_username',
  'username_taken',
  'invalid_sort',
  'invalid_response',
  'unavailable',
  'invalid_watch_position',
  'episode_not_available',
  'not_watch_admin',
  'rights_confirmation_required',
  'invalid_watch_provider',
  'invalid_watch_episode',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ApiError';
  }
}

/** Turn a PostgREST error into an ApiError. */
export function toApiError(error: { message?: string; code?: string }): ApiError {
  const message = (error.message ?? '').trim();
  const known = API_ERROR_CODES.find((code) => message === code || message.includes(code));
  if (known) return new ApiError(known);
  // "permission denied for function ..." is what a signed-out visitor gets from a members-only function.
  if (error.code === '42501' || /permission denied/i.test(message)) return new ApiError('not_authenticated');
  return new ApiError('unavailable', error.code ? `database error ${error.code}` : 'request failed');
}

const FRIENDLY: Record<ApiErrorCode, string> = {
  not_authenticated: 'Sign in to do that.',
  title_not_found: 'That title is not in the catalog.',
  invalid_status: 'Choose one of the listed statuses.',
  invalid_progress: 'Progress must be zero or more.',
  progress_exceeds_total: 'That is more than this title has in total. Lower the number.',
  invalid_rating: 'Ratings go from 1 to 10.',
  invalid_username: 'Usernames are 3 to 24 letters, numbers or underscores.',
  username_taken: 'That username is taken. Try another.',
  invalid_sort: 'That sort order is not available.',
  invalid_response: 'We got an unexpected answer from the database. Try again in a moment.',
  unavailable: 'Something went wrong on our side. Try again in a moment.',
  invalid_watch_position: 'The playback position was outside the allowed range.',
  episode_not_available: 'That licensed episode is no longer available.',
  not_watch_admin: 'Your account is not authorized to manage streaming sources.',
  rights_confirmation_required: 'Confirm that you have the rights to stream this episode.',
  invalid_watch_provider: 'Check the provider name, secure URL, country code and availability type.',
  invalid_watch_episode: 'Check the episode number, secure video URL, format and rights-holder details.',
};

export function friendlyMessage(error: unknown): string {
  return error instanceof ApiError ? FRIENDLY[error.code] : FRIENDLY.unavailable;
}
