"use client";
import { browserId } from "@/lib/browser-id";
import { useState } from "react";
import { ArrowRight, ArrowLeft, MapPin, Plug, Zap, Check } from "lucide-react";
import { Busy, ErrorMessage, Modal, post } from "./ui";
import { money } from "@/lib/money";
import type { Property } from "@/lib/types";
export function AddCharger({
  demo,
  onClose,
  onAdd,
}: {
  demo: boolean;
  onClose: () => void;
  onAdd: (property: Property) => void;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(browserId);
  const [form, setForm] = useState({
    name: "",
    address: "",
    city: "",
    state: "",
    latitude: "",
    longitude: "",
    connector_type: "J1772",
    max_kw: "7.2",
    rate: "0.35",
    instructions: "Park by the charger, plug in, and make yourself at home.",
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  function field(name: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [name]: value }));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      const input = {
        id,
        name: form.name,
        address: form.address,
        city: form.city,
        state: form.state.toUpperCase(),
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        time_zone: form.time_zone,
        connector_type: form.connector_type,
        max_kw: Number(form.max_kw),
        rate_cents: Math.round(Number(form.rate) * 100),
        instructions: form.instructions,
      };
      if (demo) {
        onAdd({
          ...input,
          host_id: "demo",
          slug: "demo",
          hold_cents: 2500,
          station_name: `SQ-${id.slice(0, 6).toUpperCase()}`,
          station_id: 3,
          connector_id: 3,
          location_id: 3,
          tariff_id: 3,
          ocpp_url: null,
          published: true,
          created_at: new Date().toISOString(),
        });
      } else {
        const result = await post<{ property: Property }>(
          "/api/host/properties",
          input,
        );
        onAdd(result.property);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function locate() {
    if (!navigator.geolocation) {
      setError(
        "Location is unavailable in this browser. Enter the coordinates below.",
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        field("latitude", p.coords.latitude.toFixed(6));
        field("longitude", p.coords.longitude.toFixed(6));
      },
      () =>
        setError(
          "We couldn’t get your location. Enter the property coordinates below.",
        ),
    );
  }
  return (
    <Modal title="A new home for good energy" onClose={onClose}>
      <div className="wizard-steps">
        {["Your place", "Your charger", "Your price"].map((label, i) => (
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
            <label>
              Street address
              <input
                value={form.address}
                onChange={(e) => field("address", e.target.value)}
                placeholder="24 Pine Ridge Road"
                required
                minLength={3}
                maxLength={120}
              />
            </label>
            <div className="form-row">
              <label>
                City
                <input
                  value={form.city}
                  onChange={(e) => field("city", e.target.value)}
                  placeholder="Asheville"
                  required
                  minLength={2}
                />
              </label>
              <label>
                State
                <input
                  value={form.state}
                  onChange={(e) => field("state", e.target.value)}
                  placeholder="NC"
                  minLength={2}
                  maxLength={2}
                  required
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Latitude
                <input
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  value={form.latitude}
                  onChange={(e) => field("latitude", e.target.value)}
                  placeholder="35.5951"
                  required
                />
              </label>
              <label>
                Longitude
                <input
                  type="number"
                  step="any"
                  min="-180"
                  max="180"
                  value={form.longitude}
                  onChange={(e) => field("longitude", e.target.value)}
                  placeholder="-82.5515"
                  required
                />
              </label>
            </div>
            <button className="text-link" type="button" onClick={locate}>
              <MapPin size={14} /> Use my current location
            </button>
            <label>
              Time zone
              <input
                value={form.time_zone}
                onChange={(e) => field("time_zone", e.target.value)}
                required
              />
            </label>
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
                  max="5"
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
                <strong>{money(Math.round(Number(form.rate) * 2000))}</strong>
              </p>
              <p>
                <span>Squid fee · 6%</span>
                <span>
                  {money(Math.round(Number(form.rate) * 2000 * 0.06))}
                </span>
              </p>
              <p>
                <span>You receive · 94%</span>
                <strong className="green">
                  {money(
                    Math.round(Number(form.rate) * 2000) -
                      Math.round(Number(form.rate) * 2000 * 0.06),
                  )}
                </strong>
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
          {step > 0 && (
            <button
              className="button secondary"
              type="button"
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft size={16} /> Back
            </button>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? (
              <Busy>Connecting…</Busy>
            ) : (
              <>
                {step === 2 ? "Add charger" : "Continue"}
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
