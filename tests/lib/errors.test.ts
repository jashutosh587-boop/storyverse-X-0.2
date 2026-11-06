import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, ApiError, friendlyMessage, toApiError } from '@/lib/api/errors';

describe('toApiError', () => {
  it('recognises the errors the database raises on purpose', () => {
    for (const code of API_ERROR_CODES.filter((c) => c !== 'unavailable' && c !== 'invalid_response')) {
      expect(toApiError({ message: code }).code).toBe(code);
      expect(toApiError({ message: `  ${code}\n` }).code).toBe(code);
    }
  });

  it('treats a permission error as "sign in"', () => {
    expect(toApiError({ code: '42501', message: 'whatever' }).code).toBe('not_authenticated');
    expect(toApiError({ message: 'permission denied for function upsert_library_entry' }).code).toBe('not_authenticated');
  });

  it('hides anything else behind "unavailable", without keeping the raw message', () => {
    const error = toApiError({ code: '57014', message: 'canceling statement due to statement timeout on relation "titles"' });
    expect(error.code).toBe('unavailable');
    expect(error.message).not.toContain('titles');
    expect(error.message).toContain('57014');
  });

  it('does not match a code that is only part of a longer message', () => {
    expect(toApiError({ message: 'username_taken by someone' }).code).toBe('unavailable');
  });
});

describe('friendlyMessage', () => {
  it('has plain words for every code', () => {
    for (const code of API_ERROR_CODES) {
      const text = friendlyMessage(new ApiError(code));
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toContain('_');
    }
  });

  it('says the same thing for any unexpected error', () => {
    expect(friendlyMessage(new Error('connect ECONNREFUSED 10.0.0.5:5432'))).toBe(friendlyMessage(new ApiError('unavailable')));
    expect(friendlyMessage('boom')).toBe(friendlyMessage(new ApiError('unavailable')));
  });
});
