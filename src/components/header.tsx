import Link from 'next/link';
import { CATEGORIES } from '@/lib/categories';
import { getCurrentUser, getMyProfile } from '@/lib/data';
import { AccountMenu } from './account-menu';
import { NavLinks } from './nav-links';

export async function Header() {
  const user = await getCurrentUser();
  const profile = user ? await getMyProfile() : null;

  const nav = [
    ...CATEGORIES.map((c) => ({ href: `/${c.slug}`, label: c.label })),
    { href: '/search', label: 'Search' },
    ...(user ? [{ href: '/library', label: 'Library' }] : []),
  ];

  return (
    <header className="border-b border-line">
      <div className="shell flex flex-wrap items-center gap-x-6 gap-y-1 pt-3 md:flex-nowrap">
        <Link href="/" className="display shrink-0 py-1 text-3xl" aria-label="Storyverse X, home">
          Storyverse <span className="text-violet">X</span>
        </Link>

        <div className="order-last w-full md:order-none md:w-auto md:flex-1">
          <NavLinks items={nav} />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2 pb-2 md:pb-3">
          {user ? (
            <AccountMenu username={profile?.username ?? null} />
          ) : (
            <>
              <Link href="/login" className="btn btn-quiet btn-sm">
                Sign in
              </Link>
              <Link href="/signup" className="btn btn-primary btn-sm">
                Create account
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
