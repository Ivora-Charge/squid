"use client";
import { useState } from "react";
import {
  ArrowRight,
  Mail,
  Check,
  LockKeyhole,
  Eye,
  EyeOff,
  ArrowLeft,
} from "lucide-react";
import { Busy, ErrorMessage, post } from "./ui";

type Mode = "signin" | "signup" | "recover" | "link";
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.02 46.98 31.86 46.98 24.55Z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.41 14.41 0 0 1 9.75 24c0-1.59.27-3.13.78-4.59l-7.98-6.19A23.89 23.89 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
      />
    </svg>
  );
}
export function LoginForm({ initialError = "" }: { initialError?: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<"form" | "google" | null>(null);
  const [error, setError] = useState(initialError);
  function switchMode(value: Mode) {
    setMode(value);
    setSent(false);
    setError("");
    setPassword("");
    setShowPassword(false);
  }
  async function google() {
    setBusy("google");
    setError("");
    try {
      const data = await post<{ url: string }>("/auth/google", {});
      window.location.assign(data.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy("form");
    setError("");
    try {
      if (mode === "signin") {
        await post("/auth/password", { email, password });
        window.location.replace("/dashboard");
        return;
      }
      if (mode === "signup") {
        const data = await post<{ confirmationRequired: boolean }>(
          "/auth/signup",
          { email, password },
        );
        if (!data.confirmationRequired) {
          window.location.replace("/dashboard");
          return;
        }
      } else {
        await post(mode === "recover" ? "/auth/recover" : "/auth/login", {
          email,
        });
      }
      setPassword("");
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  if (sent)
    return (
      <div className="email-sent" role="status">
        <div className="round-icon">
          <Check />
        </div>
        <h3>Check your inbox</h3>
        {mode === "recover" ? (
          <p>
            If an account exists for <strong>{email}</strong>, you’ll receive a
            link to choose a new password.
          </p>
        ) : mode === "signup" ? (
          <p>
            If this is a new account, check <strong>{email}</strong> for a
            confirmation link. Already registered? Sign in or reset your
            password.
          </p>
        ) : (
          <p>
            We sent a sign-in link to <strong>{email}</strong>. Open it to get
            started.
          </p>
        )}
        <p className="fine-print">
          Look for Squid by Ivora, and check your spam folder too.
        </p>
        <div className="auth-links">
          <button
            type="button"
            className="text-link"
            onClick={() => switchMode("signin")}
          >
            Back to sign in
          </button>
          <button
            type="button"
            className="text-link"
            onClick={() => setSent(false)}
          >
            Try again
          </button>
        </div>
      </div>
    );
  const passwordMode = mode === "signin" || mode === "signup";
  const labels = {
    signin: "Sign in to Squid",
    signup: "Create account",
    recover: "Send reset link",
    link: "Send me a sign-in link",
  };
  return (
    <div className="auth-methods">
      {passwordMode ? (
        <>
          <div className="auth-tabs" aria-label="Account access">
            <button
              type="button"
              aria-pressed={mode === "signin"}
              disabled={!!busy}
              onClick={() => switchMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === "signup"}
              disabled={!!busy}
              onClick={() => switchMode("signup")}
            >
              Create an account
            </button>
          </div>
          <button
            type="button"
            className="button secondary full google-signin"
            disabled={!!busy}
            onClick={google}
          >
            {busy === "google" ? (
              <Busy>Connecting…</Busy>
            ) : (
              <>
                <GoogleMark /> Continue with Google
              </>
            )}
          </button>
          <div className="auth-divider">
            <span>or use your email</span>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            className="text-link"
            disabled={!!busy}
            onClick={() => switchMode("signin")}
          >
            <ArrowLeft size={15} /> Back to sign in
          </button>
          <h2 className="auth-mode-title">
            {mode === "recover"
              ? "Forgot your password?"
              : "A link to let you in."}
          </h2>
          <p className="fine-print">
            {mode === "recover"
              ? "We’ll email you a link to set a new password."
              : "We’ll send a one-time link to your inbox."}
          </p>
        </>
      )}
      <form onSubmit={submit} className="stack-form">
        <label htmlFor="login-email">
          Email address
          <div className="input-icon">
            <Mail size={17} />
            <input
              id="login-email"
              name="email"
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourhappyplace.com"
              autoComplete="email"
              disabled={!!busy}
            />
          </div>
        </label>
        {passwordMode && (
          <label htmlFor="login-password">
            Password
            <div className="input-icon">
              <LockKeyhole size={17} />
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={mode === "signup" ? 8 : 1}
                maxLength={mode === "signup" ? 72 : 128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  mode === "signup" ? "At least 8 characters" : "Your password"
                }
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                disabled={!!busy}
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
        )}
        {mode === "signin" && (
          <button
            type="button"
            className="text-link forgot-password"
            disabled={!!busy}
            onClick={() => switchMode("recover")}
          >
            Forgot password?
          </button>
        )}
        <ErrorMessage message={error} />
        <button type="submit" className="button primary full" disabled={!!busy}>
          {busy === "form" ? (
            <Busy />
          ) : (
            <>
              {labels[mode]} <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>
      {passwordMode && (
        <button
          type="button"
          className="text-link auth-link-option"
          disabled={!!busy}
          onClick={() => switchMode("link")}
        >
          Email me a sign-in link instead
        </button>
      )}
    </div>
  );
}
