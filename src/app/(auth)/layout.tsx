import type { ReactNode } from "react";
import Link from "next/link";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        {/* Wordmark */}
        <div className="flex flex-col items-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-900">
            <span className="text-xl font-bold text-white">M</span>
          </div>
          <h2 className="mt-4 text-center text-3xl font-bold tracking-tight text-neutral-900">
            Muneem Ji
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            Your CA practice, modernised
          </p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-neutral-200 bg-white px-8 py-8 shadow-sm">
          {children}
        </div>

        <p className="text-center text-sm text-neutral-400">
          By continuing, you agree to our{" "}
          <Link
            href="/terms"
            className="text-neutral-600 underline underline-offset-4 hover:text-neutral-900"
          >
            Terms
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy"
            className="text-neutral-600 underline underline-offset-4 hover:text-neutral-900"
          >
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
