import type { MetadataRoute } from 'next';
import { CATEGORIES } from '@/lib/categories';
import { readEnv } from '@/lib/env';

// The site's address arrives as a run-time setting, so this is built per request, not at build time.
export const dynamic = 'force-dynamic';

/**
 * Lists the fixed pages only. Individual titles are not listed yet: that needs
 * a paged list of every slug, and a sitemap index once the catalog passes
 * 50,000 titles (see docs/STATUS.md).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const env = readEnv();
  if (!env.ok || !env.siteUrl) return []; // URLs in a sitemap must be absolute
  const base = env.siteUrl;
  return [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    ...CATEGORIES.map((c) => ({ url: `${base}/${c.slug}`, changeFrequency: 'daily' as const, priority: 0.8 })),
    { url: `${base}/about`, changeFrequency: 'monthly', priority: 0.3 },
  ];
}
