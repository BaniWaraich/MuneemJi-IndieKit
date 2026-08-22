"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { OWNER_AUTH_STYLES } from "../owner-auth-styles";

export function OwnerLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    global?: string;
  }>({});
  const [loading, setLoading] = useState(false);

  function validate() {
    const e: typeof errors = {};
    if (!email.trim()) e.email = "Email is required";
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = "Enter a valid email";
    if (!password) e.password = "Password is required";
    return e;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate();
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const res = await signIn("client-credentials", {
        email,
        password,
        redirect: false,
      });
      if (res?.error) {
        setErrors({ global: "Invalid email or password" });
      } else {
        router.push("/owner/dashboard");
      }
    } catch {
      setErrors({ global: "Something went wrong. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mj-root">
      <style dangerouslySetInnerHTML={{ __html: OWNER_AUTH_STYLES }} />
      <div className="page-wrap">
        <div className="card">
          <Link href="/" className="brand">
            <span className="brand-glyph" />
            <span className="brand-name">Muneem Ji</span>
          </Link>

          <h1>Welcome back</h1>
          <p className="subtitle">Sign in to your business owner account</p>

          {errors.global && <div className="global-error">{errors.global}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={errors.email ? "err" : ""}
                placeholder="you@yourbusiness.com"
              />
              {errors.email && <p className="field-error">{errors.email}</p>}
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={errors.password ? "err" : ""}
                placeholder="••••••••"
              />
              {errors.password && (
                <p className="field-error">{errors.password}</p>
              )}
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Signing in…" : "Sign in →"}
            </button>
          </form>

          <hr className="divider" />

          <div className="footer-links">
            <span>
              New here? <Link href="/owner/signup">Create an account</Link>
            </span>
            <span>
              Are you an accountant? <Link href="/login">Sign in here</Link>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
