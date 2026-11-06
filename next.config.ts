import type { NextConfig } from 'next';

// Keep in step with src/lib/image-hosts.ts (a test checks this).
const IMAGE_HOSTS = ['cdn.myanimelist.net', 'image.tmdb.org', 'covers.openlibrary.org'];

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    remotePatterns: IMAGE_HOSTS.map((hostname) => ({ protocol: 'https' as const, hostname })),
  },
  async headers() {
    // The Content-Security-Policy is set per request in middleware.ts (it carries a nonce).
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // Browsers only honour this over HTTPS; it is harmless on plain HTTP.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default config;
