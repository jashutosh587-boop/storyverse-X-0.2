/**
 * TEST ONLY. A stand-in for the two Supabase services the web app talks to, so
 * the site can be exercised end to end without a Supabase project:
 *
 *   /rest/v1/rpc/<function>  what PostgREST does: run the real SQL function from
 *                            supabase/migrations inside Postgres (PGlite), as the
 *                            database role named in the caller's JWT.
 *   /auth/v1/...             the small part of GoTrue the app uses: sign up,
 *                            password and refresh-token and PKCE sign-in, current
 *                            user, password change, sign out (with its scopes),
 *                            and the emailed confirmation and recovery links.
 *                            Behaviour copied from GoTrue's source (internal/api:
 *                            auth.go, recover.go, verify.go, user.go, logout.go),
 *                            not from a running project.
 *
 * What this proves: the web app's wiring (cookies, server actions, redirects, CSP,
 * error handling) works against the real database rules. What it does NOT prove:
 * that a hosted Supabase project behaves identically. See docs/STATUS.md.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import type { PGlite } from '@electric-sql/pglite';
import { as, createTestDb } from '../../tests/helpers/db';
import { ANON_KEY, signJwt, verifyJwt } from './jwt';
import { OUTAGE_DETAIL } from './constants';
import { seed } from './seed';

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 54321);
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
interface User {
  id: string;
  email: string;
  password: string;
  confirmed: boolean;
  meta: Record<string, unknown>;
  createdAt: string;
  /** When a recovery email was last sent, for the sending limit. */
  recoverySentAt?: number;
}

const usersByEmail = new Map<string, User>();
const usersById = new Map<string, User>();
const refreshTokens = new Map<string, { userId: string; sessionId: string }>(); // refresh token -> who it belongs to, and which sign-in
/** The sign-ins that still exist (session id -> user id). Signing out deletes them, and a deleted one cannot be renewed or used. */
const liveSessions = new Map<string, string>();
const authCodes = new Map<string, { userId: string; challenge: string }>();
type LinkKind = 'signup' | 'recovery';
const pendingLinks = new Map<string, { kind: LinkKind; userId: string; challenge: string; redirectTo: string }>();
const sentEmails: Array<{ to: string; kind: LinkKind; link: string }> = [];
const settings = {
  requireConfirmation: false,
  accessTokenTtl: 3600,
  outage: 'none' as 'none' | 'database' | 'auth',
  /** Seconds that must pass between two recovery emails to the same address (GoTrue's SMTP max frequency). 0 turns the limit off. */
  recoveryMinInterval: 0,
};
/** What the tests can ask the stand-in afterwards. */
const stats = { refreshGrants: 0, refreshRejected: 0 };

// PGlite is one connection: serialize everything that sets a role and runs a query.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function send(res: http.ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  if (status === 204 || body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const text = JSON.stringify(body, (_key, value) => (typeof value === 'bigint' ? Number(value) : value));
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(text);
}

const bearer = (req: http.IncomingMessage) => /^Bearer (.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1];

// ---------------------------------------------------------------------------
// PostgREST: /rest/v1/rpc/<fn>
// ---------------------------------------------------------------------------
interface FnInfo {
  names: string[];
  types: string[];
  returnsVoid: boolean;
  count: number;
}
const fnCache = new Map<string, FnInfo | null>();

async function functionInfo(db: PGlite, name: string): Promise<FnInfo | null> {
  if (fnCache.has(name)) return fnCache.get(name)!;
  const res = await db.query<{ proargnames: string[] | null; argtypes: string[]; returnsvoid: boolean }>(
    `select p.proargnames,
            array(select format_type(t, null) from unnest(string_to_array(p.proargtypes::text, ' ')::oid[]) t) as argtypes,
            p.prorettype = 'void'::regtype as returnsvoid
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [name],
  );
  const info =
    res.rows.length === 0
      ? null
      : {
          names: res.rows[0]!.proargnames ?? [],
          types: res.rows[0]!.argtypes,
          returnsVoid: res.rows[0]!.returnsvoid,
          count: res.rows.length,
        };
  fnCache.set(name, info);
  return info;
}

async function handleRpc(db: PGlite, req: http.IncomingMessage, res: http.ServerResponse, fn: string) {
  if (req.headers.apikey !== ANON_KEY) {
    return send(res, 401, { message: 'Invalid API key', hint: 'Double check your Supabase `anon` or `service_role` API key.' });
  }
  const token = bearer(req);
  const claims = token ? verifyJwt(token) : null;
  if (!claims) return send(res, 401, { code: 'PGRST301', details: null, hint: null, message: 'JWT expired' });
  const authenticated = claims.role === 'authenticated' && typeof claims.sub === 'string';

  if (settings.outage === 'database') return send(res, 503, { code: 'PGRST000', details: null, hint: null, message: OUTAGE_DETAIL });

  const args = await readBody(req);
  const info = await exclusive(() => functionInfo(db, fn));
  if (!info) {
    return send(res, 404, { code: 'PGRST202', details: null, hint: null, message: `Could not find the function public.${fn} in the schema cache` });
  }

  // Like PostgREST: pass the JSON body as named arguments, typed from the function's own signature.
  const keys = Object.keys(args);
  const unknown = keys.find((key) => !info.names.includes(key));
  if (unknown) {
    return send(res, 404, { code: 'PGRST202', details: null, hint: null, message: `Could not find the function public.${fn}(${keys.join(', ')}) in the schema cache` });
  }
  const columns = keys.map((key) => `"${key}" ${info.types[info.names.indexOf(key)]}`).join(', ');
  const sql = keys.length
    ? `select public.${fn}(${keys.map((key) => `"${key}" => r."${key}"`).join(', ')}) as result from jsonb_to_record($1::jsonb) as r(${columns})`
    : `select public.${fn}() as result`;

  try {
    const result = await exclusive(() =>
      as(db, authenticated ? { role: 'authenticated', userId: claims.sub as string } : { role: 'anon' }, () =>
        db.query<{ result: unknown }>(sql, keys.length ? [JSON.stringify(args)] : []),
      ),
    );
    if (info.returnsVoid) return send(res, 204);
    return send(res, 200, result.rows[0]?.result ?? null);
  } catch (error) {
    const e = error as { message?: string; code?: string; detail?: string; hint?: string };
    const code = e.code ?? 'P0001';
    const status = code === '42501' ? (authenticated ? 403 : 401) : code.startsWith('23') ? 409 : code === '42883' ? 404 : 400;
    return send(res, status, { code, details: e.detail ?? null, hint: e.hint ?? null, message: e.message ?? 'error' });
  }
}

// ---------------------------------------------------------------------------
// GoTrue: /auth/v1
// ---------------------------------------------------------------------------
const authError = (res: http.ServerResponse, status: number, errorCode: string, msg: string) =>
  send(res, status, { code: status, error_code: errorCode, msg });

function userJson(user: User) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: user.confirmed ? user.createdAt : null,
    phone: '',
    confirmed_at: user.confirmed ? user.createdAt : null,
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: user.meta,
    identities: [],
    created_at: user.createdAt,
    updated_at: user.createdAt,
    is_anonymous: false,
  };
}

/** A new sign-in gets a new session; renewing a token keeps the session it belongs to. */
function issueSession(user: User, sessionId: string = crypto.randomUUID()) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + settings.accessTokenTtl;
  const refresh = crypto.randomBytes(9).toString('base64url');
  refreshTokens.set(refresh, { userId: user.id, sessionId });
  liveSessions.set(sessionId, user.id);
  return {
    access_token: signJwt({
      aud: 'authenticated',
      exp,
      iat,
      iss: `${BASE}/auth/v1`,
      sub: user.id,
      email: user.email,
      phone: '',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: user.meta,
      role: 'authenticated',
      aal: 'aal1',
      amr: [{ method: 'password', timestamp: iat }],
      session_id: sessionId,
      is_anonymous: false,
    }),
    token_type: 'bearer',
    expires_in: settings.accessTokenTtl,
    expires_at: exp,
    refresh_token: refresh,
    user: userJson(user),
  };
}

/**
 * GoTrue looks up the session named in an access token's session_id claim on every authenticated call and answers 403
 * session_not_found if it has been deleted, even while the token itself has not expired (auth.go, maybeLoadUserOrSession).
 * Without this, a token that is still inside its lifetime would keep working after the member signed out everywhere.
 */
function sessionIsGone(claims: Record<string, unknown>): boolean {
  return typeof claims.session_id === 'string' && !liveSessions.has(claims.session_id);
}

/** "Send" the emailed link: the tests read it back from /__test/emails and open it the way a browser would. */
function sendLink(user: User, kind: LinkKind, challenge: string, redirectTo: string) {
  const token = crypto.randomBytes(12).toString('base64url');
  pendingLinks.set(token, { kind, userId: user.id, challenge, redirectTo });
  sentEmails.push({ to: user.email, kind, link: `${BASE}/auth/v1/verify?token=${token}&type=${kind}&redirect_to=${encodeURIComponent(redirectTo)}` });
}

async function userStillExists(db: PGlite, id: string): Promise<boolean> {
  const res = await exclusive(() => db.query('select 1 from auth.users where id = $1', [id]));
  return res.rows.length > 0;
}

async function handleAuth(db: PGlite, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const route = url.pathname.replace('/auth/v1', '');
  const method = req.method ?? 'GET';
  if (settings.outage === 'auth') return send(res, 503, { code: 503, error_code: 'unexpected_failure', msg: OUTAGE_DETAIL });

  if (route === '/signup' && method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authError(res, 422, 'validation_failed', 'Unable to validate email address: invalid format');
    if (password.length < 6) return authError(res, 422, 'weak_password', 'Password should be at least 6 characters.');
    if (usersByEmail.has(email)) return authError(res, 422, 'user_already_exists', 'User already registered');

    const meta = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;
    let id: string;
    try {
      // The same insert GoTrue does, so the real handle_new_user trigger creates the profile.
      const row = await exclusive(() =>
        db.query<{ id: string }>('insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id', [email, JSON.stringify(meta)]),
      );
      id = row.rows[0]!.id;
    } catch {
      return authError(res, 500, 'unexpected_failure', 'Database error saving new user');
    }
    const user: User = { id, email, password, confirmed: !settings.requireConfirmation, meta, createdAt: new Date().toISOString() };
    usersByEmail.set(email, user);
    usersById.set(id, user);

    if (!settings.requireConfirmation) return send(res, 200, issueSession(user));

    sendLink(user, 'signup', String(body.code_challenge ?? ''), url.searchParams.get('redirect_to') ?? BASE);
    return send(res, 200, userJson(user));
  }

  if (route === '/recover' && method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authError(res, 422, 'validation_failed', 'Unable to validate email address: invalid format');
    if (!body.code_challenge) return authError(res, 400, 'validation_failed', 'This stand-in only supports the PKCE flow, which the site always uses');
    // GoTrue answers 200 whether or not the address has an account.
    const user = usersByEmail.get(email);
    if (!user) return send(res, 200, {});
    // ...but the sending limit is applied only to addresses that have one. That is why the site must not show this error.
    if (user.recoverySentAt && Date.now() - user.recoverySentAt < settings.recoveryMinInterval * 1000) {
      return authError(res, 429, 'over_email_send_rate_limit', `For security purposes, you can only request this after ${settings.recoveryMinInterval} seconds.`);
    }
    user.recoverySentAt = Date.now();
    sendLink(user, 'recovery', String(body.code_challenge), url.searchParams.get('redirect_to') ?? BASE);
    return send(res, 200, {});
  }

  if (route === '/verify' && method === 'GET') {
    const pending = pendingLinks.get(url.searchParams.get('token') ?? '');
    const redirectTo = url.searchParams.get('redirect_to') ?? BASE;
    if (!pending) {
      const target = `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`;
      return send(res, 303, undefined, { Location: target });
    }
    pendingLinks.delete(url.searchParams.get('token')!);
    // Opening either kind of link proves the address is the visitor's, so an unconfirmed account becomes confirmed (GoTrue's recoverVerify does the same).
    const user = usersById.get(pending.userId);
    if (user) user.confirmed = true;
    const code = crypto.randomBytes(12).toString('base64url');
    authCodes.set(code, { userId: pending.userId, challenge: pending.challenge });
    return send(res, 303, undefined, { Location: `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}code=${code}` });
  }

  if (route === '/token' && method === 'POST') {
    const body = await readBody(req);
    const grant = url.searchParams.get('grant_type');

    if (grant === 'password') {
      const user = usersByEmail.get(String(body.email ?? '').trim().toLowerCase());
      if (!user || user.password !== String(body.password ?? '') || !(await userStillExists(db, user.id))) {
        return authError(res, 400, 'invalid_credentials', 'Invalid login credentials');
      }
      if (!user.confirmed) return authError(res, 400, 'email_not_confirmed', 'Email not confirmed');
      return send(res, 200, issueSession(user));
    }

    if (grant === 'refresh_token') {
      const token = String(body.refresh_token ?? '');
      const held = refreshTokens.get(token);
      const user = held ? usersById.get(held.userId) : undefined;
      if (!user || !(await userStillExists(db, user.id))) {
        stats.refreshRejected += 1; // a token that was already used, or never issued: the site must not send those
        return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      }
      refreshTokens.delete(token);
      stats.refreshGrants += 1;
      return send(res, 200, issueSession(user, held!.sessionId));
    }

    if (grant === 'pkce') {
      const entry = authCodes.get(String(body.auth_code ?? ''));
      const verifier = String(body.code_verifier ?? '');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      if (!entry || entry.challenge !== challenge) return authError(res, 400, 'flow_state_not_found', 'invalid flow state, no valid flow state found');
      authCodes.delete(String(body.auth_code));
      const user = usersById.get(entry.userId);
      return user ? send(res, 200, issueSession(user)) : authError(res, 400, 'user_not_found', 'User not found');
    }

    return authError(res, 400, 'validation_failed', `unsupported grant_type ${grant}`);
  }

  if (route === '/user' && method === 'GET') {
    const claims = verifyJwt(bearer(req) ?? '');
    if (!claims || typeof claims.sub !== 'string') return authError(res, 401, 'bad_jwt', 'invalid JWT: unable to parse or verify signature, token is expired or malformed');
    const user = usersById.get(claims.sub);
    if (!user || !(await userStillExists(db, user.id))) return authError(res, 403, 'user_not_found', 'User from sub claim in JWT does not exist');
    if (sessionIsGone(claims)) return authError(res, 403, 'session_not_found', 'Session from session_id claim in JWT does not exist');
    return send(res, 200, userJson(user));
  }

  if (route === '/user' && method === 'PUT') {
    const claims = verifyJwt(bearer(req) ?? '');
    if (!claims || typeof claims.sub !== 'string') return authError(res, 401, 'bad_jwt', 'invalid JWT: unable to parse or verify signature, token is expired or malformed');
    const user = usersById.get(claims.sub);
    if (!user || !(await userStillExists(db, user.id))) return authError(res, 403, 'user_not_found', 'User from sub claim in JWT does not exist');
    if (sessionIsGone(claims)) return authError(res, 403, 'session_not_found', 'Session from session_id claim in JWT does not exist');
    const body = await readBody(req);
    if (typeof body.password === 'string') {
      if (body.password.length < 6) return authError(res, 422, 'weak_password', 'Password should be at least 6 characters.');
      if (body.password === user.password) return authError(res, 422, 'same_password', 'New password should be different from the old password.');
      user.password = body.password;
    }
    return send(res, 200, userJson(user));
  }

  if (route === '/logout' && method === 'POST') {
    const claims = verifyJwt(bearer(req) ?? '');
    const scope = url.searchParams.get('scope') ?? 'global'; // GoTrue's default is to end every session
    if (!['global', 'local', 'others'].includes(scope)) return authError(res, 400, 'validation_failed', `Unsupported logout scope "${scope}"`);
    if (claims && typeof claims.sub === 'string') {
      if (sessionIsGone(claims)) return authError(res, 403, 'session_not_found', 'Session from session_id claim in JWT does not exist');
      for (const [sessionId, userId] of liveSessions) {
        if (userId !== claims.sub) continue;
        const mine = sessionId === claims.session_id;
        if (scope === 'global' || (scope === 'local' && mine) || (scope === 'others' && !mine)) liveSessions.delete(sessionId);
      }
      // A session's refresh tokens go with it.
      for (const [token, held] of refreshTokens) if (!liveSessions.has(held.sessionId)) refreshTokens.delete(token);
    }
    return send(res, 204);
  }

  return send(res, 404, { message: `no route ${method} ${url.pathname}` });
}

// ---------------------------------------------------------------------------
// Test controls (not part of Supabase)
// ---------------------------------------------------------------------------
async function handleTest(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (url.pathname === '/__test/config' && req.method === 'POST') {
    const body = await readBody(req);
    if (typeof body.requireConfirmation === 'boolean') settings.requireConfirmation = body.requireConfirmation;
    if (typeof body.accessTokenTtl === 'number') settings.accessTokenTtl = body.accessTokenTtl;
    if (typeof body.recoveryMinInterval === 'number') settings.recoveryMinInterval = body.recoveryMinInterval;
    if (body.outage === 'none' || body.outage === 'database' || body.outage === 'auth') settings.outage = body.outage;
    return send(res, 200, settings);
  }
  if (url.pathname === '/__test/stats' && req.method === 'GET') return send(res, 200, stats);
  if (url.pathname === '/__test/emails' && req.method === 'GET') {
    const to = url.searchParams.get('to')?.toLowerCase();
    return send(res, 200, sentEmails.filter((mail) => !to || mail.to === to));
  }
  return send(res, 404, { message: 'no such test control' });
}

// ---------------------------------------------------------------------------
async function main() {
  const db = await createTestDb();
  // MOCK_SUPABASE_EMPTY=1 skips the seed: what a brand-new project looks like before its first import.
  const { titles } = process.env.MOCK_SUPABASE_EMPTY === '1' ? { titles: 0 } : await seed(db);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', BASE);
    const done = (async () => {
      if (url.pathname === '/__health') return send(res, 200, { ok: true });
      if (url.pathname.startsWith('/__test/')) return handleTest(req, res, url);
      if (url.pathname.startsWith('/auth/v1/')) return handleAuth(db, req, res, url);
      const rpc = /^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/.exec(url.pathname);
      if (rpc && req.method === 'POST') return handleRpc(db, req, res, rpc[1]!);
      return send(res, 404, { message: `no route ${req.method} ${url.pathname}` });
    })();
    done.catch((error: unknown) => {
      console.error('[mock-supabase]', error);
      if (!res.headersSent) send(res, 500, { message: 'mock server error' });
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[mock-supabase] listening on ${BASE} with ${titles} seeded test titles`);
  });

  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((error) => {
  console.error('[mock-supabase] failed to start', error);
  process.exit(1);
});
