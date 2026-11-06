import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AuthRetryableFetchError, createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeAuthFailure, isOutage, type AuthIntent } from '@/lib/auth-errors';

const INTENTS: AuthIntent[] = ['sign-in', 'sign-up', 'reset-request', 'new-password'];

describe('describeAuthFailure', () => {
  it('never calls an outage a wrong password, or anything else the visitor could have caused', () => {
    const outages = [
      { name: 'AuthRetryableFetchError', status: 0 }, // the service could not be reached at all
      { name: 'AuthRetryableFetchError', status: 503 },
      { name: 'AuthApiError', status: 500, code: 'unexpected_failure' },
      { name: 'AuthUnknownError' }, // an answer that was not from the auth service (a proxy's error page)
    ];
    for (const intent of INTENTS) {
      for (const error of outages) {
        const failure = describeAuthFailure(error, intent);
        expect(failure.error, `${intent} with ${JSON.stringify(error)}`).toMatch(/unavailable|could not (send|save)/i);
        expect(failure.error).not.toMatch(/not right|taken|stronger|current password/i);
        expect(failure.fieldErrors).toBeUndefined();
      }
    }
  });

  it('tells a visitor who is going too fast to wait, whichever limit they hit', () => {
    for (const code of ['over_request_rate_limit', 'over_email_send_rate_limit', 'over_sms_send_rate_limit']) {
      for (const intent of INTENTS.filter((i) => i !== 'reset-request' || code !== 'over_email_send_rate_limit')) {
        expect(describeAuthFailure({ code, status: 429 }, intent).error, `${intent} ${code}`).toBe('Too many attempts. Wait a few minutes and try again.');
      }
    }
    expect(describeAuthFailure({ status: 429 }, 'sign-in').error).toMatch(/too many attempts/i);
  });

  it('does not let the per-address sending limit show which addresses have an account', () => {
    // The service applies that limit only to addresses that have an account, so reporting it would reveal them.
    expect(describeAuthFailure({ code: 'over_email_send_rate_limit', status: 429 }, 'reset-request')).toEqual({});
    // A limit that applies to everyone is not a secret.
    expect(describeAuthFailure({ code: 'over_request_rate_limit', status: 429 }, 'reset-request').error).toMatch(/too many attempts/i);
  });

  describe('signing in', () => {
    it('gives one answer for a wrong password, an unknown address and anything else the service refuses', () => {
      const wrong = 'The email address or password is not right.';
      expect(describeAuthFailure({ code: 'invalid_credentials', status: 400 }, 'sign-in')).toEqual({ error: wrong });
      expect(describeAuthFailure({ code: 'user_not_found', status: 400 }, 'sign-in')).toEqual({ error: wrong });
      expect(describeAuthFailure({ status: 400 }, 'sign-in')).toEqual({ error: wrong });
    });

    it('explains an unconfirmed address, and how to get past an expired link', () => {
      const { error } = describeAuthFailure({ code: 'email_not_confirmed', status: 400 }, 'sign-in');
      expect(error).toContain('Confirm your email address first.');
      expect(error).toContain('Forgot your password?');
    });

    it('says a blocked account cannot sign in', () => {
      expect(describeAuthFailure({ code: 'user_banned', status: 403 }, 'sign-in').error).toBe('This account cannot sign in right now.');
    });
  });

  describe('signing up', () => {
    it('puts a password or address problem beside its field', () => {
      expect(describeAuthFailure({ code: 'weak_password', status: 422 }, 'sign-up')).toEqual({ fieldErrors: { password: 'Choose a stronger password.' } });
      for (const code of ['email_address_invalid', 'email_address_not_authorized']) {
        expect(describeAuthFailure({ code, status: 400 }, 'sign-up')).toEqual({ fieldErrors: { email: 'That email address cannot be used here.' } });
      }
    });

    it('says sign-ups are closed when they are', () => {
      expect(describeAuthFailure({ code: 'signup_disabled', status: 422 }, 'sign-up').error).toBe('New accounts cannot be created right now.');
    });

    it('does not say whether an address is already registered', () => {
      for (const code of ['user_already_exists', 'email_exists', 'validation_failed', undefined]) {
        const { error } = describeAuthFailure({ code, status: 422 }, 'sign-up');
        expect(error).toBe('We could not create that account. If you already have one, sign in instead.');
      }
    });
  });

  describe('asking for a reset link', () => {
    it('reports a problem on the site\'s side, never one about the address', () => {
      expect(describeAuthFailure({ code: 'unexpected_failure', status: 500 }, 'reset-request').error).toMatch(/could not send the email/i);
      expect(describeAuthFailure({ code: 'email_address_not_authorized', status: 400 }, 'reset-request').error).toMatch(/could not send the email/i);
    });
  });

  describe('choosing a new password', () => {
    it('puts a password problem beside the field', () => {
      expect(describeAuthFailure({ code: 'same_password', status: 422 }, 'new-password').fieldErrors?.password).toMatch(/current password/i);
      expect(describeAuthFailure({ code: 'weak_password', status: 422 }, 'new-password').fieldErrors?.password).toBe('Choose a stronger password.');
    });

    it('sends the visitor back to a fresh link when the project wants more proof than their session', () => {
      for (const code of ['reauthentication_needed', 'reauthentication_not_valid', 'current_password_required', 'current_password_invalid']) {
        const { error } = describeAuthFailure({ code, status: 400 }, 'new-password');
        expect(error, code).toContain('fresh reset link');
        expect(error, code).toContain('Forgot your password?');
      }
    });

    it('says the link is spent when the session is gone', () => {
      const gone = [{ code: 'session_expired' }, { code: 'session_not_found' }, { code: 'bad_jwt' }, { code: 'refresh_token_not_found' }, { name: 'AuthSessionMissingError', status: 400 }, { status: 401 }];
      for (const error of gone) {
        expect(describeAuthFailure(error, 'new-password').error, JSON.stringify(error)).toMatch(/expired or was already used/);
      }
    });

    it('has something useful to say about an error it does not know', () => {
      expect(describeAuthFailure({ code: 'something_new', status: 400 }, 'new-password').error).toMatch(/could not save that password/i);
    });
  });
});

describe('isOutage', () => {
  it('is true only when the service is unreachable or failing', () => {
    expect(isOutage({ name: 'AuthRetryableFetchError', status: 0 })).toBe(true);
    expect(isOutage({ status: 500 })).toBe(true);
    expect(isOutage({ status: 502 })).toBe(true);
    expect(isOutage({ name: 'AuthUnknownError' })).toBe(true);
    for (const status of [400, 401, 403, 422, 429]) expect(isOutage({ status })).toBe(false);
    expect(isOutage({})).toBe(false);
  });
});

/**
 * The tests above hand in plain objects. These ones hand in what the real auth client produces from real answers, so the
 * messages do not depend on a guess about the shape of its errors.
 */
describe('with the errors the real auth client produces', () => {
  type Reply = { status: number; type: string; body: string };
  let reply: Reply = { status: 200, type: 'application/json', body: '{}' };
  let server: http.Server;
  let url = '';

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(reply.status, { 'Content-Type': reply.type });
      res.end(reply.body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const client = (base = url) => createClient(base, 'anon-key', { auth: { persistSession: false, autoRefreshToken: false } });
  const json = (status: number, errorCode: string, msg: string): Reply => ({ status, type: 'application/json', body: JSON.stringify({ code: status, error_code: errorCode, msg }) });

  it('recognises a service that cannot be reached', async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const dead = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const { error } = await client(dead).auth.signInWithPassword({ email: 'a@example.test', password: 'whatever' });
    expect(error).toBeInstanceOf(AuthRetryableFetchError);
    expect(error?.status, 'a network failure has no HTTP status, which is how it slipped past a plain status check').toBe(0);
    expect(isOutage(error!)).toBe(true);
    expect(describeAuthFailure(error!, 'sign-in').error).toBe('Sign-in is unavailable right now. Try again in a moment.');
  });

  it('maps what the auth service answers', async () => {
    const cases: Array<{ answer: Reply; intent: AuthIntent; call: () => Promise<{ error: { name: string; code?: string; status?: number } | null }>; expected: unknown }> = [
      {
        answer: json(400, 'invalid_credentials', 'Invalid login credentials'),
        intent: 'sign-in',
        call: () => client().auth.signInWithPassword({ email: 'a@example.test', password: 'x' }),
        expected: { error: 'The email address or password is not right.' },
      },
      {
        answer: json(400, 'email_not_confirmed', 'Email not confirmed'),
        intent: 'sign-in',
        call: () => client().auth.signInWithPassword({ email: 'a@example.test', password: 'x' }),
        expected: { error: expect.stringContaining('Confirm your email address first.') },
      },
      {
        answer: json(500, 'unexpected_failure', 'Database error'),
        intent: 'sign-in',
        call: () => client().auth.signInWithPassword({ email: 'a@example.test', password: 'x' }),
        expected: { error: 'Sign-in is unavailable right now. Try again in a moment.' },
      },
      {
        answer: { status: 502, type: 'text/html', body: '<h1>Bad gateway</h1>' },
        intent: 'sign-in',
        call: () => client().auth.signInWithPassword({ email: 'a@example.test', password: 'x' }),
        expected: { error: 'Sign-in is unavailable right now. Try again in a moment.' },
      },
      {
        answer: { status: 400, type: 'text/html', body: '<h1>Not an auth answer</h1>' },
        intent: 'sign-in',
        call: () => client().auth.signInWithPassword({ email: 'a@example.test', password: 'x' }),
        expected: { error: 'Sign-in is unavailable right now. Try again in a moment.' },
      },
      {
        answer: json(429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after 60 seconds.'),
        intent: 'reset-request',
        call: () => client().auth.resetPasswordForEmail('a@example.test', { redirectTo: 'http://127.0.0.1:3000/auth/recovery' }),
        expected: {},
      },
      {
        answer: json(429, 'over_request_rate_limit', 'Request rate limit reached'),
        intent: 'reset-request',
        call: () => client().auth.resetPasswordForEmail('a@example.test'),
        expected: { error: 'Too many attempts. Wait a few minutes and try again.' },
      },
      {
        answer: json(422, 'weak_password', 'Password should be at least 6 characters.'),
        intent: 'sign-up',
        call: () => client().auth.signUp({ email: 'a@example.test', password: 'short' }),
        expected: { fieldErrors: { password: 'Choose a stronger password.' } },
      },
    ];

    for (const { answer, intent, call, expected } of cases) {
      reply = answer;
      const { error } = await call();
      expect(error, `the client reports ${answer.status} ${answer.body.slice(0, 40)}`).not.toBeNull();
      expect(describeAuthFailure(error!, intent), `${intent} after ${answer.status} ${answer.body.slice(0, 40)}`).toEqual(expected);
    }
  });

  it('treats a missing session as an expired link', async () => {
    const { error } = await client().auth.updateUser({ password: 'a new password' });
    expect(error?.name).toBe('AuthSessionMissingError');
    expect(describeAuthFailure(error!, 'new-password').error).toMatch(/expired or was already used/);
  });
});
