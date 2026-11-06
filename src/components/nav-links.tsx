'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="-mb-px flex flex-wrap gap-x-5">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`relative whitespace-nowrap py-2 text-[0.95rem] ${
              active ? 'text-text after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-violet' : 'text-muted hover:text-text'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
