/**
 * TEST ONLY. HS256 tokens like the ones Supabase issues, signed with a secret
 * that exists only for the end-to-end tests.
 */
import crypto from 'node:crypto';

export const TEST_JWT_SECRET = 'e2e-only-jwt-secret-this-is-not-a-real-secret-0123456789';

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

export function signJwt(payload: Record<string, unknown>, secret = TEST_JWT_SECRET): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

/** The payload when the signature is right and the token has not expired; otherwise null. */
export function verifyJwt(token: string, secret = TEST_JWT_SECRET): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** The "anon" API key the web app is configured with during the tests. */
export const ANON_KEY = signJwt({ iss: 'supabase-e2e-mock', role: 'anon', iat: 1_700_000_000, exp: 4_102_444_800 });
