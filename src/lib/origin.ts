import 'server-only';
import { headers } from 'next/headers';
import { readEnv } from './env';

/**
 * The public address of this site, for links that must be absolute (the
 * confirmation link in a sign-up email). SITE_URL wins; without it the address
 * comes from the request, which trusts the proxy's forwarded headers, so set
 * SITE_URL in production.
 */
export async function siteOrigin(): Promise<string> {
  const env = readEnv();
  if (env.ok && env.siteUrl) return env.siteUrl;
  const h = await headers();
  const host = h.get('x-forwarded-host')?.split(',')[0]?.trim() ?? h.get('host') ?? 'localhost:3000';
  const local = host.startsWith('localhost') || host.startsWith('127.');
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? (local ? 'http' : 'https');
  return `${proto}://${host}`;
}
