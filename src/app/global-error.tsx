'use client';

import '@fontsource-variable/hanken-grotesk';
import '@fontsource/instrument-serif/400.css';
import './globals.css';

/** The last resort: the root layout itself failed, so this brings its own page shell. */
export default function GlobalError() {
  return (
    <html lang="en">
      <body>
        <main className="shell py-16">
          <div className="panel max-w-2xl">
            <h1 className="display text-4xl">Storyverse X cannot load right now</h1>
            <p className="mt-3 text-muted">Something failed before the page could be drawn. Try again in a moment.</p>
            {/* The root layout is gone, so there is no router to refresh: load the page again. */}
            <button type="button" onClick={() => window.location.reload()} className="btn btn-primary mt-5">
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
