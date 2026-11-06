import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SignInForm } from '@/components/auth-forms';
import { SetupRequired } from '@/components/states';
import type { RawSearchParams } from '@/lib/browse-params';
import { getBackend, getCurrentUser } from '@/lib/data';
import { safeNext } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LoginPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const raw = await searchParams;
  const next = safeNext(first(raw.next), '/');

  const backend = await getBackend();
  if (!backend.ok) return <SetupRequired problems={backend.problems} />;
  if (await getCurrentUser()) redirect(next);

  return (
    <div className="shell py-14">
      <div className="mx-auto max-w-md">
        <h1 className="display text-5xl">Sign in</h1>
        {first(raw.error) === 'callback' ? (
          <p role="alert" className="notice notice-error mt-6 text-sm">
            That confirmation link did not work. It may have expired, or it was opened in a different browser from the one you signed up in. If
            you already confirmed your email, sign in below. If not, choose “Forgot your password?” below: the link it sends confirms your email
            address as well.
          </p>
        ) : null}
        <div className="panel mt-6">
          <SignInForm next={next} />
        </div>
        <p className="mt-5 text-muted">
          New here?{' '}
          <Link href={`/signup${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`} className="link">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
