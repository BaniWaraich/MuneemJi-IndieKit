import { Metadata } from "next"
import Link from "next/link"
import { appConfig } from "@/lib/config"
import { SignUpForm } from "@/components/auth/signup-form"
import { AuthForm } from "@/components/auth/auth-form"

export const metadata: Metadata = {
  title: "Sign Up",
  description: `Create your ${appConfig.projectName} account`,
}

export default function SignUpPage() {
  const showPasswordAuth = appConfig.auth?.enablePasswordAuth;

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">
          Create an account
        </h1>
        <p className="text-sm text-muted-foreground">
          Get started with {appConfig.projectName} today
        </p>
      </div>

      {showPasswordAuth ? <SignUpForm /> : <AuthForm />}

      <div className="mt-6 text-center">
        <Link
          href="/sign-in"
          className="text-sm text-primary hover:text-primary/90 underline underline-offset-4"
        >
          Already have an account? Sign in
        </Link>
      </div>
    </>
  )
} 