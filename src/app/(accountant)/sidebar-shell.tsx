"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const NAV = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Clients", href: "/clients" },
];

export function SidebarShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-neutral-100">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white">
        {/* Logo */}
        <div className="border-b border-neutral-200 px-5 py-4">
          <span className="text-base font-bold tracking-tight text-neutral-900">
            Muneem Ji
          </span>
          <p className="mt-0.5 text-[11px] text-neutral-400">CA Practice OS</p>
        </div>

        {/* Nav links */}
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {NAV.map(({ label, href }) => {
            const active =
              href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-neutral-100 text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-neutral-200 px-4 py-4">
          <p className="truncate text-xs text-neutral-500">{email}</p>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="mt-2 text-xs text-neutral-400 transition-colors hover:text-neutral-700"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
