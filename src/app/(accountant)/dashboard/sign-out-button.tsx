'use client';

import { signOut } from 'next-auth/react';

export function SignOutButton({ callbackUrl = '/login' }: { callbackUrl?: string }) {
  return (
    <button
      onClick={() => signOut({ callbackUrl })}
      className="text-sm text-neutral-500 transition-colors hover:text-neutral-700"
    >
      Sign out
    </button>
  );
}
