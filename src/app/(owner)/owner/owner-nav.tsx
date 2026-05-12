'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/owner/dashboard', label: 'Dashboard' },
  { href: '/owner/statements', label: 'Statements' },
  { href: '/owner/pending', label: 'Pending' },
];

export function OwnerNav() {
  const pathname = usePathname();
  return (
    <nav className="rounded-xl border border-neutral-200 bg-white p-2 shadow-sm">
      <ul className="space-y-1">
        {items.map((it) => {
          const active = pathname === it.href || pathname.startsWith(it.href + '/');
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-primary-light text-primary font-medium'
                    : 'text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
