"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Busy, ErrorMessage, post } from "./ui";

export function ResetPassword({ signedIn }: { signedIn: boolean }) {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [verified, setVerified] = useState(signedIn);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get(
      "token_hash",
    );
    if (value) {
      setToken(value);
      history.replaceState(null, "", "/login/reset");
    }
    setReady(true);
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("Your passwords don’t match.");
      return;
    }
    setBusy(true);
    try {
      // Opening a link or scanning the page never consumes the recovery token.
      if (token) {
        await post("/auth/recover/confirm", { token_hash: token });
        setToken("");
        setVerified(true);
      }
      const response = await fetch("/auth/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Could not save your password.");
      setPassword("");
      setConfirmation("");
      window.location.replace("/dashboard");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="stack-form">
      <p>Choose a password with at least 8 characters.</p>
      {ready && !token && !verified ? (
        <p>
          Open your original reset link from your email, or sign in to set a
          password.
        </p>
      ) : (
        <form className="stack-form" onSubmit={submit}>
          <label htmlFor="new-password">
            New password
            <div className="input-icon">
              <LockKeyhole size={17} />
              <input
                id="new-password"
                type="password"
                name="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={72}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </div>
          </label>
          <label htmlFor="confirm-password">
            Confirm new password
            <div className="input-icon">
              <LockKeyhole size={17} />
              <input
                id="confirm-password"
                type="password"
                name="confirmation"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={72}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                disabled={busy}
              />
            </div>
          </label>
          <ErrorMessage message={error} />
          <button className="button primary full" disabled={!ready || busy}>
            {busy ? (
              <Busy>Saving…</Busy>
            ) : (
              <>
                Save new password <ArrowRight size={17} />
              </>
            )}
          </button>
        </form>
      )}
      <Link href="/login" className="text-link">
        Back to sign in <ArrowRight size={14} />
      </Link>
    </div>
  );
}
