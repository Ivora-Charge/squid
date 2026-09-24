"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Zap,
  Check,
  ArrowRight,
  ShieldCheck,
  Download,
  Leaf,
  Square,
  RotateCw,
} from "lucide-react";
import { Brand, Busy, ErrorMessage, post } from "./ui";
import { money } from "@/lib/money";
import type { PublicSession } from "@/lib/types";
export function SessionView({
  initial,
  propertyName,
  demo = false,
}: {
  initial: PublicSession;
  propertyName: string;
  demo?: boolean;
}) {
  const [s, setSession] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    // The server-rendered controls must wait for their click handlers to load.
    setInteractive(true);
    const timer = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (demo && s.status === "charging") {
      const timer = setInterval(
        () =>
          setSession((old) => ({
            ...old,
            energy_kwh: Number((old.energy_kwh + 0.04).toFixed(2)),
          })),
        1000,
      );
      return () => clearInterval(timer);
    }
  }, [demo, s.status]);
  useEffect(() => {
    if (demo || ["completed", "canceled", "refunded"].includes(s.status))
      return;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const result = await post<{ session: PublicSession }>(
          `/api/sessions/${initial.id}`,
          { action: "sync" },
        );
        if (!canceled) {
          setSession(result.session);
          setError("");
        }
      } catch (e) {
        if (!canceled) setError((e as Error).message);
      } finally {
        if (!canceled) timer = setTimeout(tick, 6000);
      }
    }
    void tick();
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [demo, initial.id, s.status]);
  useEffect(() => {
    if (["completed", "canceled", "refunded"].includes(s.status)) {
      const key = sessionStorage.getItem(`squid-session:${s.id}`);
      if (key) sessionStorage.removeItem(key);
    }
  }, [s.id, s.status]);
  async function stop() {
    setBusy(true);
    setError("");
    try {
      if (demo) {
        setSession((old) => ({
          ...old,
          status: "completed",
          total_cents: Math.round(old.energy_kwh * old.rate_cents),
          ended_at: new Date().toISOString(),
        }));
      } else {
        const result = await post<{ session: PublicSession }>(
          `/api/sessions/${s.id}`,
          { action: "stop" },
        );
        setSession(result.session);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const complete = s.status === "completed";
  const charging = s.status === "charging";
  const pending = s.status === "awaiting_payment";
  const statusText = {
    awaiting_payment: "A little step before you charge.",
    starting: "Getting your charger ready.",
    charging: "Your car is recharging. You can too.",
    stopping: "Wrapping up your charge.",
    settling: "Measuring the good energy.",
    completed: "Ready for your next adventure.",
    canceled: "All set. Your session is canceled.",
    refunded: "A little good energy, returned.",
    review: "Your session needs a little help.",
  }[s.status];
  const duration = s.started_at
    ? Math.max(
        0,
        Math.floor(
          ((s.ended_at ? Date.parse(s.ended_at) : Date.now()) -
            Date.parse(s.started_at)) /
            60000,
        ),
      )
    : 0;
  void seconds;
  return (
    <div className="session-layout">
      <header className="guest-header">
        <Brand small />
        {demo && <span className="demo-label">DEMO SESSION</span>}
      </header>
      <main id="main" className="session-card">
        <div className={`session-icon ${charging ? "charging" : ""}`}>
          {complete ? <Check size={30} /> : <Zap size={30} />}
        </div>
        <p className="eyebrow">{propertyName.toUpperCase()}</p>
        <h1>{statusText}</h1>
        <p>
          {charging
            ? "No need to wait here. We’ll keep an eye on your charge."
            : complete
              ? "Thanks for sharing a little good energy with your host."
              : pending
                ? "Authorize your temporary hold securely with Stripe, then return here."
                : s.status === "review"
                  ? "Please contact your host. We won’t guess the charging or payment outcome."
                  : "This page follows the confirmed charger and payment status."}
        </p>
        {(charging ||
          complete ||
          ["stopping", "settling", "starting"].includes(s.status)) && (
          <>
            <div className="energy-orbit">
              <svg viewBox="0 0 200 200" aria-hidden="true">
                <circle cx="100" cy="100" r="87" />
                <circle
                  className="orbit-progress"
                  cx="100"
                  cy="100"
                  r="87"
                  strokeDasharray={`${complete ? 547 : Math.min(510, 80 + s.energy_kwh * 10)} 547`}
                />
              </svg>
              <div>
                <Zap size={20} />
                <strong>{Number(s.energy_kwh).toFixed(2)}</strong>
                <span>kWh of good energy</span>
              </div>
            </div>
            <div className="session-metrics">
              <div>
                <span>{complete ? "Final cost" : "Estimated cost"}</span>
                <strong>
                  {money(
                    complete
                      ? (s.total_cents ?? 0)
                      : Math.round(s.energy_kwh * s.rate_cents),
                  )}
                </strong>
              </div>
              <div>
                <span>Time connected</span>
                <strong>
                  {duration}
                  <small> min</small>
                </strong>
              </div>
              <div>
                <span>Your rate</span>
                <strong>
                  {money(s.rate_cents)}
                  <small> / kWh</small>
                </strong>
              </div>
            </div>
          </>
        )}
        <ErrorMessage message={error} />
        {pending && s.checkout_url && (
          <a href={s.checkout_url} className="button primary full large">
            Authorize {money(s.hold_cents)} hold <ArrowRight size={18} />
          </a>
        )}
        {["awaiting_payment", "starting", "charging", "stopping"].includes(
          s.status,
        ) && (
          <button
            className={`button ${charging ? "secondary" : "subtle"} full`}
            disabled={!interactive || busy || s.status === "stopping"}
            onClick={stop}
          >
            {busy ? (
              <Busy />
            ) : (
              <>
                <Square size={15} />
                {pending
                  ? "Cancel this session"
                  : s.status === "stopping"
                    ? "Waiting for charger to stop…"
                    : "Finish charging"}
              </>
            )}
          </button>
        )}
        {complete && (
          <>
            <div className="success-message">
              <ShieldCheck size={18} />
              {demo
                ? "Demo receipt. No payment was made."
                : `Paid ${money(s.total_cents ?? 0)}. The unused hold has been released.`}
            </div>
            <button
              className="button secondary full"
              disabled={!interactive}
              onClick={() => window.print()}
            >
              <Download size={16} /> Save receipt
            </button>
          </>
        )}
        {demo && (
          <Link href="/demo" className="text-link centered-link">
            Back to the host experience <ArrowRight size={15} />
          </Link>
        )}
        <p className="fine-print">
          <Leaf size={13} /> A little charge. A better stay.
        </p>
        <small className="session-reference">Session {s.id.slice(0, 12)}</small>
      </main>
    </div>
  );
}
