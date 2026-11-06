import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from '@/components/auth-forms';
import { SetupRequired } from '@/components/states';
import type { RawSearchParams } from '@/lib/browse-params';
import { getBackend } from '@/lib/data';

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false } };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const raw = await searchParams;
  const backend = await getBackend();
  if (!backend.ok) return <SetupRequired problems={backend.problems} />;

  return (
    <div className="shell py-14">
      <div className="mx-auto max-w-md">
        <h1 className="display text-5xl">Reset your password</h1>
        <p className="mt-2 text-muted">Enter the email address you signed up with. We will email you a link to choose a new password.</p>
        {first(raw.error) === 'link' ? (
          <p role="alert" className="notice notice-error mt-6 text-sm">
            That link did not work. It may have expired, been used already, or been opened in a different browser from the one you asked in.
            Ask for a new one below, and open it in this browser.
          </p>
        ) : null}
        <div className="panel mt-6">
          <ForgotPasswordForm />
        </div>
        <p className="mt-5 text-muted">
          Remembered it?{' '}
          <Link href="/login" className="link">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
