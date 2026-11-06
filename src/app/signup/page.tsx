import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SignUpForm } from '@/components/auth-forms';
import { SetupRequired } from '@/components/states';
import type { RawSearchParams } from '@/lib/browse-params';
import { getBackend, getCurrentUser } from '@/lib/data';
import { safeNext } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Create an account', robots: { index: false } };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SignupPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const next = safeNext(first((await searchParams).next), '/');

  const backend = await getBackend();
  if (!backend.ok) return <SetupRequired problems={backend.problems} />;
  if (await getCurrentUser()) redirect(next);

  return (
    <div className="shell py-14">
      <div className="mx-auto max-w-md">
        <h1 className="display text-5xl">Create an account</h1>
        <p className="mt-2 text-muted">An account lets you keep a library, track progress and rate what you finish.</p>
        <div className="panel mt-6">
          <SignUpForm next={next} />
        </div>
        <p className="mt-5 text-muted">
          Already have an account?{' '}
          <Link href={`/login${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`} className="link">
            Sign in
          </Link>
        </p>
        <p className="mt-2 text-sm text-muted">
          Signed up earlier but never confirmed your email, and the username is now taken?{' '}
          <Link href="/forgot-password" className="link">
            Reset your password
          </Link>{' '}
          to get a new link that confirms it.
        </p>
      </div>
    </div>
  );
}
