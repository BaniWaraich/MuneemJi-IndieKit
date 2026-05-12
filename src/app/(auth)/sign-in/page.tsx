import { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = {
  title: "Sign In — Muneem Ji",
  description: "Sign in to your Muneem Ji account",
};

export default function SignInPage() {
  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Sign in
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Welcome back to your CA dashboard
        </p>
      </div>

      <AuthForm />

      <div className="mt-6 text-center">
        <Link
          href="/sign-up"
          className="text-sm text-neutral-500 underline underline-offset-4 hover:text-neutral-900"
        >
          Don&apos;t have an account? Sign up
        </Link>
      </div>
    </>
  );
}
