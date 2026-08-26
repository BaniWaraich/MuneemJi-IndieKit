"use client";

export default function OwnerError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-900">
        Couldn&apos;t load this page
      </h2>
      <p className="mt-2 text-sm text-neutral-500">
        Please try again. If it keeps happening, refresh or sign in again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="bg-primary hover:bg-primary-hover focus:ring-primary mt-4 inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
      >
        Try again
      </button>
    </div>
  );
}
