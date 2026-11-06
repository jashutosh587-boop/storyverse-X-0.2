import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DeleteAccountForm, ProfileForm } from '@/components/profile-forms';
import { SetupRequired } from '@/components/states';
import { getProfile } from '@/lib/api/profile';
import { getBackend, getCurrentUser } from '@/lib/data';

export const metadata: Metadata = { title: 'Settings', robots: { index: false } };

export default async function SettingsPage() {
  const backend = await getBackend();
  if (!backend.ok) return <SetupRequired problems={backend.problems} />;
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=%2Fsettings');

  const profile = await getProfile(backend.supabase);
  if (!profile) {
    return (
      <div className="shell py-14">
        <div className="panel max-w-xl">
          <h1 className="display text-4xl">We could not find your profile</h1>
          <p className="mt-2 text-muted">Your sign-in works, but the profile record that goes with it is missing. Try again in a moment.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell py-10">
      <h1 className="display text-5xl md:text-6xl">Settings</h1>
      <p className="mt-2 text-muted">Signed in as {user.email}</p>

      <div className="mt-10 grid max-w-2xl gap-12">
        <section aria-labelledby="profile-heading">
          <h2 id="profile-heading" className="display text-3xl">
            Profile
          </h2>
          <div className="panel mt-4">
            <ProfileForm profile={profile} />
          </div>
        </section>

        <section aria-labelledby="password-heading">
          <h2 id="password-heading" className="display text-3xl">
            Password
          </h2>
          <p className="mt-2 text-muted">Changing your password starts with a link we email to you.</p>
          <Link href="/forgot-password" className="btn btn-quiet mt-4">
            Email me a link to change it
          </Link>
        </section>

        <section aria-labelledby="data-heading">
          <h2 id="data-heading" className="display text-3xl">
            Your data
          </h2>
          <p className="mt-2 text-muted">
            Download everything this site holds about you, which is your email address, your profile and your library with your notes, as a JSON file.
          </p>
          <a href="/settings/export" download className="btn btn-quiet mt-4">
            Download my data
          </a>
        </section>

        <section aria-labelledby="danger-heading">
          <h2 id="danger-heading" className="display text-3xl">
            Delete account
          </h2>
          <div className="panel mt-4 border-bad/40">
            <p className="mb-4 text-muted">
              This removes your profile, your library and your ratings for good. Your ratings leave the community averages too. It cannot be
              undone.
            </p>
            <DeleteAccountForm username={profile.username} />
          </div>
        </section>
      </div>
    </div>
  );
}
