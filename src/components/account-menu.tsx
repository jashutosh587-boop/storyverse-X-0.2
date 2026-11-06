'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { signOutAction } from '@/app/actions/auth';

const ITEM = 'block w-full rounded-md px-3 py-2 text-left text-[0.95rem] hover:bg-surface';

/**
 * The signed-in visitor's menu. It is a native disclosure (<details>), so it opens
 * and closes without JavaScript; the script only closes it when you navigate,
 * press Escape or click elsewhere.
 */
export function AccountMenu({ username }: { username: string | null }) {
  const pathname = usePathname();
  const root = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (root.current) root.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const menu = root.current;
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menu.open && !menu.contains(event.target as Node)) menu.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false;
        menu.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <details ref={root} className="relative">
      <summary className="btn btn-quiet btn-sm cursor-pointer list-none">
        <span className="max-w-32 truncate">{username ? `@${username}` : 'Account'}</span>
        <span aria-hidden="true" className="text-xs text-muted">
          ▾
        </span>
        <span className="sr-only">, account menu</span>
      </summary>
      <div className="absolute right-0 top-full z-30 mt-2 w-52 rounded-lg border border-line-strong bg-raised p-1">
        {username ? (
          <Link href={`/u/${username}`} className={ITEM}>
            Your profile
          </Link>
        ) : null}
        <Link href="/library" className={ITEM}>
          Your library
        </Link>
        <Link href="/settings" className={ITEM}>
          Settings
        </Link>
        <form action={signOutAction}>
          <button type="submit" className={ITEM}>
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
