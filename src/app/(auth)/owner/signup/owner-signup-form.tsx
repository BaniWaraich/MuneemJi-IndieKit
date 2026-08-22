"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { OWNER_AUTH_STYLES } from "../owner-auth-styles";

export function OwnerSignupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{
    name?: string;
    businessName?: string;
    email?: string;
    password?: string;
    confirm?: string;
    global?: string;
  }>({});
  const [loading, setLoading] = useState(false);

  function validate() {
    const e: typeof errors = {};
    if (!name.trim()) e.name = "Enter your name";
    if (!businessName.trim()) e.businessName = "Enter your business name";
    if (!email.trim()) e.email = "Email is required";
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = "Enter a valid email";
    if (!password) e.password = "Password is required";
    else if (password.length < 8)
      e.password = "Password must be at least 8 characters";
    if (confirm !== password) e.confirm = "Passwords don't match";
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
      const res = await fetch("/api/v1/auth/owner-register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          businessName: businessName.trim(),
          email: email.trim(),
          password,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (res.status === 409) {
        setErrors({
          global: "This email is already registered — sign in instead",
        });
        return;
      }
      if (!res.ok) {
        setErrors({
          global:
            data.error || "Couldn't create your account. Please try again.",
        });
        return;
      }

      const signInRes = await signIn("client-credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });
      if (signInRes?.error) {
        router.push("/owner/login");
        return;
      }
      router.push("/owner/onboarding");
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

          <h1>Create your account</h1>
          <p className="subtitle">
            Collect invoices and bank statements in one place.
          </p>

          {errors.global && <div className="global-error">{errors.global}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                autoComplete="name"
                value={name}
                onChange={(ev) => setName(ev.target.value)}
                className={errors.name ? "err" : ""}
                placeholder="Priya Sharma"
              />
              {errors.name && <p className="field-error">{errors.name}</p>}
            </div>

            <div className="field">
              <label htmlFor="businessName">Business name</label>
              <input
                id="businessName"
                value={businessName}
                onChange={(ev) => setBusinessName(ev.target.value)}
                className={errors.businessName ? "err" : ""}
                placeholder="Sharma Traders"
              />
              {errors.businessName && (
                <p className="field-error">{errors.businessName}</p>
              )}
            </div>

            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
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
                autoComplete="new-password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                className={errors.password ? "err" : ""}
                placeholder="At least 8 characters"
              />
              {errors.password && (
                <p className="field-error">{errors.password}</p>
              )}
            </div>

            <div className="field">
              <label htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(ev) => setConfirm(ev.target.value)}
                className={errors.confirm ? "err" : ""}
                placeholder="••••••••"
              />
              {errors.confirm && (
                <p className="field-error">{errors.confirm}</p>
              )}
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Creating account…" : "Create account →"}
            </button>
          </form>

          <hr className="divider" />

          <div className="footer-links">
            <span>
              Already have an account? <Link href="/owner/login">Sign in</Link>
            </span>
            <span>
              Are you an accountant?{" "}
              <Link href="/register">Create a CA account</Link>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
