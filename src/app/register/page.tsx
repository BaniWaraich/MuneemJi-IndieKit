"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,300;1,9..144,400&family=DM+Sans:wght@300;400;500&display=swap');

  .mj-root {
    --cream: #F5F0E8;
    --cream-mid: #EDE7D9;
    --ink: #1A1614;
    --crimson: #7A1818;
    --crimson-deep: #5C1010;
    --muted: #6B6560;
    --border: rgba(26,22,20,0.12);
    --error: #B91C1C;
    font-family: 'DM Sans', system-ui, sans-serif;
    background: var(--cream);
    min-height: 100vh;
    color: var(--ink);
  }
  .mj-root * { box-sizing: border-box; }
  .mj-root .font-display { font-family: 'Fraunces', Georgia, serif; }
  .mj-root a { color: var(--crimson); text-decoration: none; }
  .mj-root a:hover { text-decoration: underline; }

  .mj-root .page-wrap {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
  }

  .mj-root .card {
    width: 100%;
    max-width: 480px;
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 48px 40px;
    box-shadow: 0 2px 16px rgba(26,22,20,0.06);
  }

  .mj-root .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 36px;
    text-decoration: none !important;
    color: var(--ink) !important;
  }
  .mj-root .brand-glyph {
    width: 28px; height: 28px;
    background: var(--crimson);
    border-radius: 3px;
    display: inline-block;
  }
  .mj-root .brand-name {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 20px;
    font-weight: 400;
    color: var(--ink);
  }

  .mj-root h1 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 26px;
    font-weight: 400;
    color: var(--ink);
    margin: 0 0 6px;
    line-height: 1.2;
  }
  .mj-root .subtitle {
    font-size: 14px;
    color: var(--muted);
    margin: 0 0 32px;
  }

  .mj-root .field { margin-bottom: 20px; }
  .mj-root label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--ink);
    margin-bottom: 6px;
    letter-spacing: 0.01em;
  }
  .mj-root input {
    width: 100%;
    padding: 10px 12px;
    font-size: 14px;
    font-family: inherit;
    color: var(--ink);
    background: var(--cream);
    border: 1px solid var(--border);
    border-radius: 3px;
    outline: none;
    transition: border-color 0.15s;
  }
  .mj-root input:focus { border-color: var(--crimson); background: #fff; }
  .mj-root input.err { border-color: var(--error); }
  .mj-root .field-error { font-size: 12px; color: var(--error); margin-top: 4px; }
  .mj-root .field-hint { font-size: 12px; color: var(--muted); margin-top: 4px; }

  .mj-root .global-error {
    background: #FEF2F2;
    border: 1px solid #FECACA;
    border-radius: 3px;
    padding: 10px 14px;
    font-size: 13px;
    color: var(--error);
    margin-bottom: 20px;
  }

  .mj-root .success-banner {
    background: #F0FDF4;
    border: 1px solid #BBF7D0;
    border-radius: 3px;
    padding: 10px 14px;
    font-size: 13px;
    color: #166534;
    margin-bottom: 20px;
  }

  .mj-root .btn-primary {
    width: 100%;
    padding: 12px;
    background: var(--crimson);
    color: #fff;
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
    margin-top: 8px;
  }
  .mj-root .btn-primary:hover:not(:disabled) { background: var(--crimson-deep); transform: translateY(-1px); }
  .mj-root .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

  .mj-root .section-label {
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    margin-bottom: 16px;
    margin-top: 28px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  .mj-root .footer-links {
    margin-top: 28px;
    text-align: center;
    font-size: 13px;
    color: var(--muted);
  }

  .mj-root .alpha-notice {
    font-size: 12px;
    color: var(--muted);
    text-align: center;
    margin-top: 16px;
    padding: 8px 12px;
    background: var(--cream-mid);
    border-radius: 3px;
  }
`;

type Fields = {
  firmName: string;
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

type FieldErrors = Partial<Record<keyof Fields | "global", string>>;

export default function RegisterPage() {
  const router = useRouter();
  const [fields, setFields] = useState<Fields>({ firmName: "", name: "", email: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  function set(key: keyof Fields) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setFields(prev => ({ ...prev, [key]: e.target.value }));
      if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }));
    };
  }

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!fields.firmName.trim()) e.firmName = "Firm name is required";
    if (!fields.name.trim()) e.name = "Your name is required";
    if (!fields.email.trim()) e.email = "Email is required";
    else if (!/\S+@\S+\.\S+/.test(fields.email)) e.email = "Enter a valid email";
    if (!fields.password) e.password = "Password is required";
    else if (fields.password.length < 8) e.password = "Password must be at least 8 characters";
    if (!fields.confirmPassword) e.confirmPassword = "Please confirm your password";
    else if (fields.password !== fields.confirmPassword) e.confirmPassword = "Passwords do not match";
    return e;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firmName: fields.firmName, name: fields.name, email: fields.email, password: fields.password }),
      });
      const data = await res.json();
      if (res.status === 403 && data.error?.includes("alpha")) {
        setErrors({ global: "Registration is currently invite-only. Contact us to join the early access programme." });
        return;
      }
      if (!res.ok) {
        const msg = data.details?.fieldErrors
          ? Object.values(data.details.fieldErrors).flat().join(". ")
          : data.error ?? "Something went wrong";
        if (data.error === "An account with this email already exists") {
          setErrors({ email: data.error });
        } else {
          setErrors({ global: msg });
        }
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push("/login"), 1500);
    } catch {
      setErrors({ global: "Network error. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mj-root">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="page-wrap">
        <div className="card">
          <Link href="/" className="brand">
            <span className="brand-glyph" />
            <span className="brand-name">Muneem Ji</span>
          </Link>

          <h1>Set up your practice</h1>
          <p className="subtitle">Create a CA account — takes under a minute</p>

          {errors.global && <div className="global-error">{errors.global}</div>}
          {success && <div className="success-banner">Account created! Redirecting to sign in…</div>}

          <form onSubmit={handleSubmit} noValidate>
            <p className="section-label">Your firm</p>

            <div className="field">
              <label htmlFor="firmName">Firm name</label>
              <input
                id="firmName"
                type="text"
                autoComplete="organization"
                value={fields.firmName}
                onChange={set("firmName")}
                className={errors.firmName ? "err" : ""}
                placeholder="Sharma & Associates"
              />
              {errors.firmName && <p className="field-error">{errors.firmName}</p>}
            </div>

            <p className="section-label">Your account</p>

            <div className="field">
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                value={fields.name}
                onChange={set("name")}
                className={errors.name ? "err" : ""}
                placeholder="CA Priya Sharma"
              />
              {errors.name && <p className="field-error">{errors.name}</p>}
            </div>

            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={fields.email}
                onChange={set("email")}
                className={errors.email ? "err" : ""}
                placeholder="priya@sharma-associates.in"
              />
              {errors.email && <p className="field-error">{errors.email}</p>}
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={fields.password}
                onChange={set("password")}
                className={errors.password ? "err" : ""}
                placeholder="Min. 8 characters"
              />
              {errors.password && <p className="field-error">{errors.password}</p>}
              {!errors.password && <p className="field-hint">At least 8 characters</p>}
            </div>

            <div className="field">
              <label htmlFor="confirmPassword">Confirm password</label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={fields.confirmPassword}
                onChange={set("confirmPassword")}
                className={errors.confirmPassword ? "err" : ""}
                placeholder="Re-enter your password"
              />
              {errors.confirmPassword && <p className="field-error">{errors.confirmPassword}</p>}
            </div>

            <button type="submit" className="btn-primary" disabled={loading || success}>
              {loading ? "Creating account…" : "Create account →"}
            </button>
          </form>

          <div className="footer-links">
            Already have an account?{" "}
            <Link href="/login">Sign in</Link>
          </div>

          <p className="alpha-notice">
            By registering you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
