"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Busy, ErrorMessage, post } from "./ui";
export function ConfirmLogin() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get(
      "token_hash",
    );
    if (value) {
      setToken(value);
      history.replaceState(null, "", "/login/confirm");
    }
    setReady(true);
  }, []);
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await post("/auth/confirm", { token_hash: token });
      setToken("");
      window.location.replace("/dashboard");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="stack-form">
      <p>Confirm to open your host workspace.</p>
      <ErrorMessage message={error} />
      {ready && !token && !busy ? (
        <p>
          Open the original link from your email, or request a fresh sign-in
          link below.
        </p>
      ) : (
        <button
          className="button primary full"
          disabled={!ready || busy || !token}
          onClick={confirm}
        >
          {busy ? (
            <Busy>Signing you in…</Busy>
          ) : (
            <>
              Sign in to Squid <ArrowRight size={17} />
            </>
          )}
        </button>
      )}
      <p className="fine-print">
        <ShieldCheck size={14} /> Only you should use your sign-in link.
      </p>
      <Link className="text-link" href="/login">
        Request a new link <ArrowRight size={14} />
      </Link>
    </div>
  );
}
