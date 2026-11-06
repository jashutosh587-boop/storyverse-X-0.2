import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, createNonce } from './lib/csp';
import { readEnv } from './lib/env';

/**
 * Runs on every page request:
 *  1. sets a Content-Security-Policy with a fresh nonce, and
 *  2. refreshes the Supabase session, so an expiring sign-in is renewed before
 *     any page code looks at it (Server Components cannot write cookies).
 */
export async function middleware(request: NextRequest) {
  const nonce = createNonce();
  const secure = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https';
  const csp = buildCsp(nonce, process.env.NODE_ENV !== 'production', secure);

  // The headers the page code will see; Next reads the nonce from the CSP request header.
  const forwardedHeaders = () => {
    const headers = new Headers(request.headers);
    headers.set('x-nonce', nonce);
    headers.set('content-security-policy', csp);
    return headers;
  };

  let response = NextResponse.next({ request: { headers: forwardedHeaders() } });

  const env = readEnv();
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'));
  if (env.ok && hasSession) {
    const supabase = createServerClient(env.supabaseUrl, env.anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: forwardedHeaders() } });
          for (const { name, value, options } of list) {
            response.cookies.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: 'lax',
              secure: process.env.NODE_ENV === 'production',
              path: '/',
            });
          }
        },
      },
    });
    // Validates the token with the auth server and rewrites the cookies if it was renewed.
    await supabase.auth.getUser();
  }

  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static files and the image optimizer.
    {
      source: '/((?!_next/static|_next/image|api/suggest|api/health|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
