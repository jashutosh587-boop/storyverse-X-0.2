import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { NewPasswordForm } from '@/components/auth-forms';
import { SetupRequired } from '@/components/states';
import { getBackend, getCurrentUser } from '@/lib/data';

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false } };

export default async function ResetPasswordPage() {
  const backend = await getBackend();
  if (!backend.ok) return <SetupRequired problems={backend.problems} />;
  // The reset link signs the visitor in, so a visitor who is not signed in has not followed one.
  if (!(await getCurrentUser())) redirect('/forgot-password?error=link');

  return (
    <div className="shell py-14">
      <div className="mx-auto max-w-md">
        <h1 className="display text-5xl">Choose a new password</h1>
        <div className="panel mt-6">
          <NewPasswordForm />
        </div>
      </div>
    </div>
  );
}
