'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';

/** Shown when a page fails while rendering. The message is deliberately generic: details stay in the server log. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  useEffect(() => {
    console.error(error);
  }, [error]);

  // reset() alone only draws the same failed page again. The page was built on the server, so it has to be fetched again too.
  const retry = () =>
    startRetry(() => {
      router.refresh();
      reset();
    });

  return (
    <div className="shell py-16">
      <div className="panel max-w-2xl">
        <h1 className="display text-4xl">Something went wrong on our side</h1>
        <p className="mt-3 text-muted">The page could not be built. Your data is safe. Try again, and if it keeps happening, come back in a few minutes.</p>
        {error.digest ? (
          <p className="mt-3 text-sm text-muted">
            Reference for the site owner: <code>{error.digest}</code>
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={retry} disabled={retrying} className="btn btn-primary">
            {retrying ? 'Trying again…' : 'Try again'}
          </button>
          <Link href="/" className="btn btn-quiet">
            Go to the home page
          </Link>
        </div>
      </div>
    </div>
  );
}
