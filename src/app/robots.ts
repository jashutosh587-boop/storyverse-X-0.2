import type { MetadataRoute } from 'next';
import { readEnv } from '@/lib/env';

// The site's address arrives as a run-time setting, so this is built per request, not at build time.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const env = readEnv();
  const siteUrl = env.ok ? env.siteUrl : undefined;
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/auth/', '/settings', '/library', '/login', '/signup', '/forgot-password', '/reset-password'] },
    // Only listed when the site's address is known, because a sitemap URL must be absolute.
    sitemap: siteUrl ? `${siteUrl}/sitemap.xml` : undefined,
  };
}
