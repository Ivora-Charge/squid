"use client";
import { browserId } from "@/lib/browser-id";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Zap,
  Plug,
  ShieldCheck,
  MapPin,
  Check,
  Leaf,
  LockKeyhole,
  WifiOff,
} from "lucide-react";
import { Brand, Busy, ErrorMessage, post } from "./ui";
import { money } from "@/lib/money";
import type { PublicProperty } from "@/lib/types";
import type { GuestAvailability } from "@/lib/status";
export function GuestCharge({
  property: p,
  demo = false,
}: {
  property: PublicProperty;
  demo?: boolean;
}) {
  const [energy, setEnergy] = useState(20);
  const [plugged, setPlugged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function checkout() {
    setBusy(true);
    setError("");
    try {
      if (demo) {
        window.location.assign("/session/demo");
        return;
      }
      const storageKey = `squid-checkout:${p.id}`;
      let requestId = sessionStorage.getItem(storageKey);
      if (!requestId) {
        requestId = browserId();
        sessionStorage.setItem(storageKey, requestId);
      }
      const result = await post<{ id: string; url: string | null }>(
        "/api/checkout",
        { slug: p.slug, requestId },
      );
      sessionStorage.setItem(`squid-session:${result.id}`, storageKey);
      // Stay on a recoverable Squid session page before opening our Stripe Checkout.
      window.location.assign(`/session/${result.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="guest-layout">
      <header className="guest-header">
        <Brand small />
        <Link href={demo ? "/demo" : "/"} className="text-link">
          {demo ? "Back to host demo" : "For hosts"}
          <ArrowUpRight size={15} />
        </Link>
      </header>
      <main id="main" className="guest-main">
        <div className="guest-photo">
          <img src="/images/cabin.jpg" alt="A peaceful vacation home" />
          <div className="photo-shade" />
          <div className="guest-photo-copy">
            <span className="eyebrow">YOU’VE ARRIVED. UNWIND.</span>
            <h1>
              A warm welcome.
              <br />
              <span>A fuller battery.</span>
            </h1>
            <p>A little good energy for wherever you’re going next.</p>
          </div>
          <span className="guest-property-caption">
            <MapPin size={15} />
            {p.city}, {p.state}
          </span>
        </div>
        <div className="guest-card">
          <div className="guest-card-top">
            <span
              className={`badge ${p.availability === "ready" ? "green-badge" : p.availability === "offline" ? "offline-badge" : "neutral-badge"}`}
            >
              <span className="status-dot" />
              {p.availability === "ready"
                ? "Ready when you are"
                : p.availability === "offline"
                  ? "Offline"
                  : "Currently unavailable"}
            </span>
            {(demo || p.testMode) && (
              <span className="demo-label">{demo ? "DEMO" : "TEST MODE"}</span>
            )}
          </div>
          <p className="eyebrow">WELCOME TO</p>
          <h2>{p.name}</h2>
          <p className="guest-description">
            {p.availability === "ready"
              ? "Settle in. Your car can recharge too."
              : "Settle in. Charging isn’t available just now."}
          </p>
          {p.availability === "ready" ? (
            <>
              <div className="guest-charger-spec">
                <span>
                  <Plug size={18} />
                  {p.connector_type}
                </span>
                <span>
                  <Zap size={18} />
                  {p.max_kw} kW max
                </span>
                <span>Level 2</span>
              </div>
              <div className="guest-price">
                <div>
                  <strong>{money(p.rate_cents)}</strong>
                  <span> / kWh</span>
                </div>
                <span>
                  Just the energy you use.
                  <br />
                  No signup. No app.
                </span>
              </div>
              <div className="estimate">
                <div>
                  <label htmlFor="energy">A little estimate</label>
                  <strong>
                    {energy} kWh <ArrowRight size={13} />{" "}
                    {money(energy * p.rate_cents)}
                  </strong>
                </div>
                <input
                  id="energy"
                  type="range"
                  min={5}
                  max={60}
                  step={5}
                  value={energy}
                  onChange={(e) => setEnergy(Number(e.target.value))}
                />
                <div className="range-labels">
                  <span>A quick top-up</span>
                  <span>Ready for the road</span>
                </div>
              </div>
              <div className="guest-instructions">
                <span className="number-circle">1</span>
                <div>
                  <h3>Plug in and make yourself at home.</h3>
                  <p>{p.instructions}</p>
                </div>
              </div>
              <div className="guest-instructions">
                <span className="number-circle">2</span>
                <div>
                  <h3>A small hold. Only pay for your charge.</h3>
                  <p>
                    We’ll authorize {money(p.hold_cents)} on your card. When
                    charging ends, we collect the final cost and release the
                    rest. We request a stop as you approach the hold amount. You
                    can start another session for more energy. Charges below
                    $0.50 are waived, with the full hold released.
                  </p>
                </div>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={plugged}
                  onChange={(e) => setPlugged(e.target.checked)}
                />
                <span>
                  I’ve plugged in my vehicle and checked the connector.
                </span>
              </label>
              <ErrorMessage message={error} />
              <button
                className="button primary full large"
                disabled={!plugged || busy}
                onClick={checkout}
              >
                {busy ? (
                  <Busy>Getting ready…</Busy>
                ) : (
                  <>
                    {demo ? "Try a demo charge" : "Continue to payment"}
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
              <div className="secure-note">
                <ShieldCheck size={15} />
                {demo
                  ? "A simulation. No card or charger required."
                  : "Secure payment through Squid’s Stripe checkout."}
              </div>
              <p className="fine-print centered">
                By continuing, you accept the{" "}
                <Link href="/terms">charging terms</Link>.<br />
                You can stop your session from your phone anytime.
              </p>
            </>
          ) : (
            <GuestUnavailable reason={p.availability} />
          )}
        </div>
      </main>
      <footer className="guest-footer">
        <span>
          <Leaf size={15} /> Good energy. A little closer to home.
        </span>
        <span>Squid by Ivora</span>
      </footer>
    </div>
  );
}
function GuestUnavailable({ reason }: { reason: GuestAvailability }) {
  const offline = reason === "offline";
  return (
    <div className="guest-offline">
      {offline ? <WifiOff size={26} /> : <Plug size={26} />}
      <div>
        <h3>
          {offline
            ? "This charger is offline right now."
            : "This charger is in use right now."}
        </h3>
        <p>
          {offline
            ? "It isn’t connected to the network, so we can’t start a charge or take a payment. Give it a few minutes, or let your host know."
            : "Another vehicle is plugged in or the connector isn’t ready. Try again once it’s free."}
        </p>
        <button
          className="button secondary"
          onClick={() => window.location.reload()}
        >
          Check again
        </button>
      </div>
    </div>
  );
}
