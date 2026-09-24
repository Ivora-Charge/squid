"use client";
import { browserId } from "@/lib/browser-id";
import { useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  MapPin,
  Plug,
  Zap,
  Check,
  CreditCard,
} from "lucide-react";
import { Busy, ErrorMessage, Modal, post } from "./ui";
import { money, splitPayment } from "@/lib/money";
import type { Property } from "@/lib/types";
import { AddressSearch } from "./address-search";
import {
  stationIdentity,
  demoAddresses,
  type AddressSelection,
} from "@/lib/onboarding";
export function AddCharger({
  demo,
  payoutsReady,
  stripeConnected,
  onClose,
  onAdd,
  onSave,
}: {
  demo: boolean;
  payoutsReady: boolean;
  stripeConnected: boolean;
  onClose: () => void;
  onAdd: (property: Property) => void;
  onSave: (property: Property) => void;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(browserId);
  const [address, setAddress] = useState<AddressSelection | null>(null);
  const [saved, setSaved] = useState<Property | null>(null);
  const needsPayouts = !payoutsReady;
  const lastStep = needsPayouts ? 3 : 2;
  const [form, setForm] = useState({
    name: "",
    connector_type: "J1772",
    max_kw: "7.2",
    rate: "0.35",
    instructions: "Park by the charger, plug in, and make yourself at home.",
  });
  function field(name: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [name]: value }));
  }
  // A 20 kWh example at the entered price; an empty field shows zeros.
  const exampleTotal = Math.round(Number(form.rate) * 2000);
  const example = splitPayment(
    Number.isSafeInteger(exampleTotal) && exampleTotal >= 0 ? exampleTotal : 0,
  );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (step === 0 && !address) {
      setError("Choose your property address from the suggestions.");
      return;
    }
    if (step < lastStep) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      if (!address) throw new Error("Please select your property address.");
      const input = {
        id,
        name: form.name,
        addressToken: address.token,
        connector_type: form.connector_type,
        max_kw: Number(form.max_kw),
        rate_cents: Math.round(Number(form.rate) * 100),
        instructions: form.instructions,
      };
      let property = saved;
      if (!property && demo) {
        const selected = demoAddresses.find((a) => a.id === address.token)!;
        property = {
          ...input,
          address: selected.address,
          city: selected.city,
          state: selected.state,
          latitude: selected.latitude,
          longitude: selected.longitude,
          time_zone: selected.time_zone,
          host_id: "demo",
          slug: "demo",
          hold_cents: 2500,
          station_name: stationIdentity(form.name, id),
          station_id: 3,
          connector_id: 3,
          location_id: 3,
          tariff_id: 3,
          ocpp_url: null,
          published: true,
          created_at: new Date().toISOString(),
        };
      } else if (!property) {
        const result = await post<{ property: Property }>(
          "/api/host/properties",
          input,
        );
        property = result.property;
      }
      setSaved(property);
      onSave(property);
      if (needsPayouts && !demo) {
        const result = await post<{ url: string }>("/api/host/connect", {
          propertyId: property.id,
        });
        window.location.assign(result.url);
      } else onAdd(property);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="A new home for good energy" onClose={onClose}>
      <div className="wizard-steps">
        {[
          "Your place",
          "Your charger",
          "Your price",
          ...(needsPayouts ? ["Payouts"] : []),
        ].map((label, i) => (
          <div className={step >= i ? "active" : ""} key={label}>
            <span>{step > i ? <Check size={13} /> : i + 1}</span>
            {label}
          </div>
        ))}
      </div>
      <form className="stack-form" onSubmit={submit}>
        {step === 0 && (
          <>
            <div className="form-intro">
              <MapPin />
              <h3>Tell us about your place.</h3>
              <p>Give guests a familiar name when they scan your sticker.</p>
            </div>
            <label>
              Property name
              <input
                value={form.name}
                onChange={(e) => field("name", e.target.value)}
                placeholder="The Weekender"
                minLength={2}
                maxLength={80}
                required
              />
            </label>
            <AddressSearch
              demo={demo}
              selection={address}
              onSelect={setAddress}
            />
          </>
        )}
        {step === 1 && (
          <>
            <div className="form-intro">
              <Plug />
              <h3>Meet your charger.</h3>
              <p>
                Your charger must support OCPP 1.6 or 2.0.1. You’ll connect it
                after this step.
              </p>
            </div>
            <label>
              Station identity
              <input readOnly value={stationIdentity(form.name, id)} />
            </label>
            <p className="fine-print">
              A short name for your charger’s connection settings. Your password
              will be prepared automatically.
            </p>
            <label>
              Connector type
              <select
                value={form.connector_type}
                onChange={(e) => field("connector_type", e.target.value)}
              >
                <option>J1772</option>
                <option>NACS</option>
                <option>Type 2</option>
              </select>
            </label>
            <label>
              Maximum power (kW)
              <input
                type="number"
                step="0.1"
                min="1"
                max="22"
                required
                value={form.max_kw}
                onChange={(e) => field("max_kw", e.target.value)}
              />
            </label>
            <label>
              A note for guests
              <textarea
                rows={3}
                maxLength={500}
                value={form.instructions}
                onChange={(e) => field("instructions", e.target.value)}
              />
            </label>
            <div className="notice">
              <Plug size={18} />
              <span>
                This registers a new charger. Configure its OCPP connection in
                your charger’s app before publishing.
              </span>
            </div>
          </>
        )}
        {step === 3 && needsPayouts && (
          <>
            <div className="form-intro">
              <CreditCard />
              <h3>A home for your earnings.</h3>
              <p>
                {stripeConnected
                  ? "Finish your Stripe setup to receive charging payouts."
                  : "Connect Stripe so your charging earnings reach your bank account."}
              </p>
            </div>
            <div className="price-breakdown">
              <p>
                <span>Squid fee</span>
                <span>6%</span>
              </p>
              <p>
                <span>Stripe processing</span>
                <span>2.9% + 30¢ per charge</span>
              </p>
              <p>
                <span>You receive</span>
                <strong>The rest of each charge</strong>
              </p>
            </div>
            <p className="fine-print">
              We’ll save your charger before opening Stripe. When you return,
              your connection details will be ready. Guest payments stay off
              until payouts and your charger are ready.
            </p>
            {saved && (
              <div className="success-message" role="status">
                <Check size={16} /> Your charger is saved. Continue to Stripe
                whenever you’re ready.
              </div>
            )}
            {demo && (
              <div className="notice">
                Demo payout setup. No Stripe account is created.
              </div>
            )}
          </>
        )}
        {step === 2 && (
          <>
            <div className="form-intro">
              <Zap />
              <h3>Your energy. Your price.</h3>
              <p>
                Guests pay only for the energy they use. No subscriptions, no
                surprises.
              </p>
            </div>
            <label>
              Price per kWh (USD)
              <div className="price-input">
                <span>$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.rate}
                  onChange={(e) => field("rate", e.target.value)}
                  required
                />
                <span>/ kWh</span>
              </div>
            </label>
            <div className="price-breakdown">
              <p>
                <span>Example: 20 kWh session</span>
                <strong>{money(example.total)}</strong>
              </p>
              <p>
                <span>Squid fee · 6%</span>
                <span>{money(example.fee)}</span>
              </p>
              <p>
                <span>Stripe processing · 2.9% + 30¢</span>
                <span>{money(example.processing)}</span>
              </p>
              <p>
                <span>You receive</span>
                <strong className="green">{money(example.host)}</strong>
              </p>
            </div>
            <p className="fine-print">
              A $25 temporary hold is released down to the final charging cost.
              Stripe Connect routes your share to your account.
            </p>
            {demo && (
              <div className="notice">
                Demo mode: this charger is saved only in your browser.
              </div>
            )}
          </>
        )}
        <ErrorMessage message={error} />
        <div className="form-actions">
          {step > 0 && !saved && (
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft size={16} /> Back
            </button>
          )}
          <button
            className="button primary"
            disabled={busy || (step === 0 && !address)}
          >
            {busy ? (
              <Busy>Connecting…</Busy>
            ) : (
              <>
                {step === 3
                  ? demo
                    ? "Finish demo setup"
                    : saved
                      ? "Continue to Stripe"
                      : "Save & connect Stripe"
                  : step === lastStep
                    ? "Add charger"
                    : "Continue"}
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
