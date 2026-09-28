import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type Stripe from "stripe";
import type { ChargeSession, Property, PublicSession } from "../types";
import {
  applicationFee,
  captureAmount,
  platformFee,
  processingFee,
  MINIMUM_CHARGE_CENTS,
} from "../money";
import { checked, db, withLock } from "./db";
import { appUrl } from "./config";
import { HttpError } from "./security";
import { stripe, payoutStatus } from "./stripe";
import {
  billSchema,
  durable,
  externalSchema,
  getExternal,
  getStation,
  operation,
  writeIvora,
  type ExternalSession,
} from "./ivora";

export const TERMINAL = ["completed", "canceled", "refunded"] as const;
export async function loadSession(id: string): Promise<ChargeSession> {
  const { data, error } = await db()
    .from("squid_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new HttpError(404, "Charging session not found.");
  return data as ChargeSession;
}
export function publicSession(s: ChargeSession): PublicSession {
  const {
    id,
    property_id,
    status,
    rate_cents,
    hold_cents,
    checkout_url,
    energy_kwh,
    total_cents,
    created_at,
    started_at,
    ended_at,
    stop_requested,
  } = s;
  return {
    id,
    property_id,
    status,
    rate_cents,
    hold_cents,
    checkout_url,
    energy_kwh: Number(energy_kwh),
    total_cents,
    created_at,
    started_at,
    ended_at,
    stop_requested,
  };
}
async function property(id: string): Promise<Property> {
  return checked(
    await db().from("squid_properties").select("*").eq("id", id).single(),
  ) as Property;
}
async function update(id: string, values: Partial<ChargeSession>) {
  checked(
    await db()
      .from("squid_sessions")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", id),
  );
}
async function ensureCheckout(s: ChargeSession, p: Property) {
  if (s.stripe_checkout_id) return;
  const key = `${s.id}:checkout`;
  const input = {
    id: s.id,
    hold: s.hold_cents,
    rate: s.rate_cents,
    account: s.stripe_account_id,
  };
  const checkout = await durable(
    key,
    input,
    async () => {
      const result = await stripe().checkout.sessions.create(
        {
          mode: "payment",
          payment_method_types: ["card"],
          client_reference_id: s.id,
          metadata: { squid_session_id: s.id },
          payment_intent_data: {
            capture_method: "manual",
            transfer_data: { destination: s.stripe_account_id },
            metadata: { squid_session_id: s.id },
          },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: s.hold_cents,
                product_data: {
                  name: `${p.name} · charging authorization`,
                  description: `Temporary hold only. Final cost is $${(s.rate_cents / 100).toFixed(2)} per kWh delivered.`,
                },
              },
            },
          ],
          success_url: `${appUrl()}/session/${s.id}`,
          cancel_url: `${appUrl()}/session/${s.id}`,
        },
        { idempotencyKey: key },
      );
      return { id: result.id, url: result.url };
    },
    true,
  );
  await update(s.id, {
    stripe_checkout_id: checkout.id,
    checkout_url: checkout.url,
  });
}
export async function createCheckout(slug: string, requestId: string) {
  const { data: p, error } = await db()
    .from("squid_properties")
    .select("*")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  if (error || !p) throw new HttpError(404, "This charger is not available.");
  return withLock(`checkout:${p.id}`, async () => {
    const { data: prior } = await db()
      .from("squid_sessions")
      .select("*")
      .eq("request_id", requestId)
      .maybeSingle();
    if (prior) {
      if (prior.property_id !== p.id)
        throw new HttpError(409, "This request belongs to another charger.");
      await ensureCheckout(prior as ChargeSession, p as Property);
      return loadSession(prior.id);
    }
    if (!p.tariff_id)
      throw new Error(
        "This charger’s price is being updated. Please try again in a moment.",
      );
    const account = await payoutStatus(p.host_id);
    if (!account.ready || !account.id)
      throw new Error(
        "Connect Stripe and finish payout onboarding before taking payments.",
      );
    const station = await getStation(p.station_id);
    const connector = station.connectors.find((c) => c.id === p.connector_id);
    if (
      !station.online ||
      !connector ||
      !["Available", "Preparing"].includes(connector.status ?? "")
    )
      throw new Error(
        "Your charger is not ready. Check the cable and try again.",
      );
    const id = randomUUID();
    const insertion = await db()
      .from("squid_sessions")
      .insert({
        id,
        request_id: requestId,
        property_id: p.id,
        host_id: p.host_id,
        stripe_account_id: account.id,
        rate_cents: p.rate_cents,
        hold_cents: p.hold_cents,
        tariff_id: p.tariff_id,
      })
      .select("*")
      .single();
    if (insertion.error?.code === "23505")
      throw new HttpError(
        409,
        "A guest is already starting or using this charger. Please try again shortly.",
      );
    const s = checked(insertion) as ChargeSession;
    await ensureCheckout(s, p as Property);
    return loadSession(id);
  });
}
async function report(
  s: ChargeSession,
  kind: "authorization" | "capture" | "release" | "refund",
  amount: number,
  reference: string,
) {
  if (!s.ivora_session_id) return;
  await writeIvora(
    `${s.id}:report:${kind}`,
    `charging-sessions/${s.ivora_session_id}/settlement-reports`,
    z.unknown(),
    {
      kind,
      operation_reference: reference,
      outcome: "succeeded",
      amount_minor: amount,
      currency: "USD",
    },
  );
}
function intentMatches(pi: Stripe.PaymentIntent, s: ChargeSession) {
  const destination = pi.transfer_data?.destination;
  const destinationId =
    typeof destination === "string" ? destination : destination?.id;
  return (
    pi.metadata.squid_session_id === s.id &&
    pi.currency === "usd" &&
    pi.amount === s.hold_cents &&
    destinationId === s.stripe_account_id &&
    pi.capture_method === "manual"
  );
}
function hasCompletedBill(external: ExternalSession) {
  return (
    external.bill.status === "final" &&
    external.bill.transaction_id !== null &&
    (external.usage
      ? !external.usage.active &&
        external.bill.transaction_id === external.usage.transaction_id
      : external.status === "completed")
  );
}
export async function reconcile(id: string): Promise<ChargeSession> {
  return withLock(`session:${id}`, async () => {
    let s = await loadSession(id);
    if (
      (TERMINAL as readonly string[]).includes(s.status) &&
      !s.refund_requested
    )
      return s;
    const p = await property(s.property_id);
    await ensureCheckout(s, p);
    s = await loadSession(id);
    const checkout = await stripe().checkout.sessions.retrieve(
      s.stripe_checkout_id!,
    );
    // Use the provider's default expiry so delayed retries have identical valid
    // parameters. Reconciliation releases abandoned reservations after 30 minutes.
    if (
      checkout.status === "open" &&
      (s.stop_requested ||
        Date.now() - Date.parse(s.created_at) > 30 * 60 * 1000)
    ) {
      await stripe().checkout.sessions.expire(
        checkout.id,
        {},
        { idempotencyKey: `${id}:expire` },
      );
      await update(id, { status: "canceled", checkout_url: null });
      return loadSession(id);
    }
    const paymentId =
      typeof checkout.payment_intent === "string"
        ? checkout.payment_intent
        : checkout.payment_intent?.id;
    if (!paymentId) {
      if (checkout.status === "expired")
        await update(id, { status: "canceled", checkout_url: null });
      return loadSession(id);
    }
    let pi = await stripe().paymentIntents.retrieve(paymentId);
    if (!intentMatches(pi, s)) {
      await update(id, {
        status: "review",
        last_error: "Payment details do not match the saved session.",
      });
      return loadSession(id);
    }
    await update(id, { stripe_payment_id: pi.id });
    s = { ...s, stripe_payment_id: pi.id };
    if (s.refund_requested && s.status === "completed") {
      const key = `${id}:refund`;
      const refund = await durable(
        key,
        { payment: pi.id },
        () =>
          stripe().refunds.create(
            {
              payment_intent: pi.id,
              reverse_transfer: true,
              refund_application_fee: true,
            },
            { idempotencyKey: key },
          ),
        true,
      );
      const observed = await stripe().refunds.retrieve(refund.id);
      if (observed.status === "succeeded") {
        await report(s, "refund", observed.amount, observed.id);
        await update(id, { status: "refunded", refund_requested: false });
      }
      return loadSession(id);
    }
    if (pi.status === "canceled") {
      // Never infer that a charger stopped from a canceled payment.
      if (!s.ivora_session_id) {
        await update(id, { status: "canceled", checkout_url: null });
        return loadSession(id);
      }
      const external = await getExternal(s.ivora_session_id);
      if (
        external.status === "canceled" &&
        !external.usage &&
        !external.start_operation
      ) {
        await report(s, "release", 0, pi.id);
        await update(id, {
          status: "canceled",
          checkout_url: null,
          last_error: null,
        });
      } else if (
        hasCompletedBill(external) &&
        external.bill.total_minor !== null &&
        external.bill.total_minor < MINIMUM_CHARGE_CENTS
      ) {
        // Recover a released hold even when the acknowledgement was lost.
        await report(s, "release", 0, pi.id);
        await update(id, {
          status: "completed",
          total_cents: 0,
          fee_cents: 0,
          stripe_fee_cents: 0,
          energy_kwh: Number(external.bill.energy_kwh ?? 0),
          started_at: external.usage?.started_at ?? s.started_at,
          ended_at: external.usage?.ended_at ?? s.ended_at,
          checkout_url: null,
          last_error: null,
        });
      } else {
        if (external.usage?.active && !external.stop_operation) {
          await operation(
            `${id}:stop`,
            `charging-sessions/${external.id}/stop`,
          );
        }
        await update(id, {
          status: "review",
          stop_requested: true,
          last_error: "Authorization ended; reconcile physical usage.",
        });
      }
      return loadSession(id);
    }
    if (pi.status !== "requires_capture" && pi.status !== "succeeded") return s;
    if (
      s.stop_requested &&
      !s.ivora_session_id &&
      pi.status === "requires_capture"
    ) {
      await stripe().paymentIntents.cancel(
        pi.id,
        {},
        { idempotencyKey: `id:${id}:cancel` },
      );
      await update(id, { status: "canceled", checkout_url: null });
      return loadSession(id);
    }
    if (!s.ivora_session_id) {
      if (
        pi.status !== "requires_capture" ||
        pi.amount_capturable < s.hold_cents
      ) {
        await update(id, { status: "review" });
        return loadSession(id);
      }
      const external = await writeIvora(
        `${id}:external`,
        "charging-sessions",
        externalSchema,
        {
          station_id: p.station_id,
          connector_id: p.connector_id,
          tariff_id: s.tariff_id,
          source: "csms",
          application_reference: `squid:${id}`,
          processor: "stripe",
          merchant_reference: s.stripe_account_id,
          payment_reference: pi.id,
        },
      );
      await update(id, { ivora_session_id: external.id, checkout_url: null });
      s = { ...s, ivora_session_id: external.id };
    }
    await report(s, "authorization", s.hold_cents, pi.id);
    let external = await getExternal(s.ivora_session_id!);
    if (
      external.status === "canceled" &&
      !external.usage &&
      !external.start_operation &&
      pi.status === "requires_capture"
    ) {
      await stripe().paymentIntents.cancel(
        pi.id,
        {},
        { idempotencyKey: `id:${id}:cancel` },
      );
      await report(s, "release", 0, pi.id);
      await update(id, {
        status: "canceled",
        checkout_url: null,
        last_error: null,
      });
      return loadSession(id);
    }
    if (
      external.status === "reconciliation_required" ||
      (external.bill.status === "final" && !hasCompletedBill(external)) ||
      (!hasCompletedBill(external) &&
        (external.start_operation?.status === "unknown" ||
          external.start_operation?.status === "rejected"))
    ) {
      await update(id, {
        status: "review",
        last_error: "Charger state needs operator review.",
      });
      return loadSession(id);
    }
    if (external.status === "prepared" && !external.start_operation) {
      if (s.stop_requested) {
        await writeIvora(
          `${id}:external-cancel`,
          `charging-sessions/${external.id}/cancel`,
          externalSchema,
        );
        await stripe().paymentIntents.cancel(
          pi.id,
          {},
          { idempotencyKey: `id:${id}:cancel` },
        );
        await report(s, "release", 0, pi.id);
        await update(id, { status: "canceled" });
        return loadSession(id);
      }
      if (
        pi.status !== "requires_capture" ||
        pi.amount_capturable < s.hold_cents
      )
        throw new Error(
          "Payment authorization is not sufficient to start charging.",
        );
      await operation(`${id}:start`, `charging-sessions/${external.id}/start`, {
        funding_confirmed: true,
      });
      await update(id, { status: "starting" });
      external = await getExternal(external.id);
    }
    if (external.usage) {
      await update(id, {
        energy_kwh: Number(external.usage.energy_kwh ?? 0),
        started_at: external.usage.started_at,
        ended_at: external.usage.ended_at,
      });
    } else if (
      external.start_operation &&
      !hasCompletedBill(external) &&
      !s.ended_at
    ) {
      await update(id, { status: "starting", checkout_url: null });
    }
    if (external.usage?.active) {
      // Leave margin for meter and network latency. The final bill is never silently capped.
      const nearLimit =
        (external.usage.estimated_minor ?? 0) >=
        Math.floor(s.hold_cents * 0.85);
      const tooLong =
        external.usage.started_at &&
        Date.now() - Date.parse(external.usage.started_at) >
          24 * 60 * 60 * 1000;
      if (s.stop_requested || nearLimit || tooLong) {
        if (
          external.stop_operation?.status === "unknown" ||
          external.stop_operation?.status === "rejected"
        ) {
          await update(id, {
            status: "review",
            stop_requested: true,
            last_error: "The charger stop needs operator review.",
          });
          return loadSession(id);
        }
        if (!external.stop_operation)
          await operation(
            `${id}:stop`,
            `charging-sessions/${external.id}/stop`,
          );
        await update(id, { status: "stopping", stop_requested: true });
      } else await update(id, { status: "charging" });
      return loadSession(id);
    }
    if (
      (external.usage && !external.usage.active) ||
      hasCompletedBill(external)
    ) {
      await update(id, { status: "settling", checkout_url: null });
      const bill =
        external.bill.status === "final"
          ? external.bill
          : await writeIvora(
              `${id}:finalize`,
              `charging-sessions/${external.id}/finalize`,
              billSchema,
              { transaction_id: external.usage!.transaction_id },
            );
      if (bill.status !== "final" || bill.total_minor === null)
        return loadSession(id);
      if (
        bill.transaction_id === null ||
        (external.usage &&
          bill.transaction_id !== external.usage.transaction_id)
      ) {
        await update(id, {
          status: "review",
          last_error: "The bill does not match this charging transaction.",
        });
        return loadSession(id);
      }
      const total = bill.total_minor;
      if (total > s.hold_cents) {
        await update(id, {
          status: "review",
          total_cents: total,
          last_error: "Final usage exceeded the hold; review required.",
        });
        return loadSession(id);
      }
      // Keep Ivora's immutable bill intact. Squid waives amounts below Stripe's
      // USD minimum instead of charging guests more than their metered usage.
      const charged = total < MINIMUM_CHARGE_CENTS ? 0 : total;
      if (charged === 0) {
        if (pi.status !== "requires_capture") {
          await update(id, {
            status: "review",
            last_error:
              "A captured payment needs review before releasing this session.",
          });
          return loadSession(id);
        }
        if (pi.status === "requires_capture")
          await stripe().paymentIntents.cancel(
            pi.id,
            {},
            { idempotencyKey: `id:${id}:cancel` },
          );
        await report(s, "release", 0, pi.id);
      } else {
        if (pi.status === "requires_capture") {
          const key = `${id}:capture`;
          const input = captureAmount(total, pi.amount_capturable);
          await durable(
            key,
            input,
            () =>
              stripe().paymentIntents.capture(pi.id, input, {
                idempotencyKey: key,
              }),
            true,
          );
        }
        pi = await stripe().paymentIntents.retrieve(pi.id);
        if (
          pi.status !== "succeeded" ||
          pi.amount_received !== total ||
          pi.application_fee_amount !== applicationFee(total)
        ) {
          await update(id, { status: "review" });
          return loadSession(id);
        }
        await report(s, "capture", total, pi.id);
      }
      await update(id, {
        status: "completed",
        total_cents: charged,
        fee_cents: platformFee(charged),
        stripe_fee_cents: processingFee(charged),
        energy_kwh: Number(bill.energy_kwh ?? 0),
        checkout_url: null,
        last_error: null,
      });
    }
    return loadSession(id);
  });
}
