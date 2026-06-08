'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [spinning, setSpinning] = useState(false);

  function handleClick() {
    setSpinning(true);
    startTransition(() => {
      router.refresh();
      // Give the server round-trip a moment before re-enabling the spinner state.
      setTimeout(() => setSpinning(false), 600);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending || spinning}
      className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:outline-none disabled:opacity-50"
    >
      {spinning || isPending ? 'Refreshing…' : 'Refresh'}
    </button>
  );
}
