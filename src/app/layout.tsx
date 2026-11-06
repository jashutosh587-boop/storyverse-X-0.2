import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource/instrument-serif/400.css';
import './globals.css';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { readEnv } from '@/lib/env';

// Everything here depends on who is asking and on settings that arrive at run time, so nothing is prerendered.
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const env = readEnv();
  return {
    // Lets link previews and canonical URLs be absolute once the site's address is configured.
    metadataBase: env.ok && env.siteUrl ? new URL(env.siteUrl) : undefined,
    title: { default: 'Storyverse X', template: '%s | Storyverse X' },
    description: 'One catalog for anime, film, TV, books, novels and manga, with the links between them.',
  };
}

export const viewport: Viewport = {
  themeColor: '#0c0b17',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
