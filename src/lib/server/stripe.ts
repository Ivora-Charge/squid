import "server-only";
import Stripe from "stripe";
import { appUrl, required } from "./config";
import { checked, db, withLock } from "./db";
import { durable, forget } from "./ivora";
import { HttpError } from "./security";

function connectFailure(stage: "account" | "link", error: unknown): never {
  if (error instanceof Stripe.errors.StripeError) {
    // Stripe request metadata is enough to investigate without logging account
    // details, the API key, or the error's potentially sensitive message.
    console.error("[Squid Stripe Connect]", {
      stage,
      type: error.type,
      code: error.code ?? null,
      status: error.statusCode ?? null,
      requestId: error.requestId ?? null,
    });
    if (error.code === "account_create_activation_required")
      throw new HttpError(
        503,
        "Squid’s Stripe platform must finish activation before payout setup. Your charger is saved; please contact Squid support.",
      );
    throw new HttpError(
      503,
      "Stripe payout setup is unavailable. Your charger is saved; please contact Squid support.",
    );
  }
  throw error;
}

export function stripe() {
  return new Stripe(required("STRIPE_SECRET_KEY"), {
    maxNetworkRetries: 2,
    timeout: 15000,
  });
}
export async function hostAccount(hostId: string) {
  const { data, error } = await db()
    .from("squid_hosts")
    .select("stripe_account_id")
    .eq("id", hostId)
    .maybeSingle();
  if (error)
    throw new Error("Database setup is incomplete. Apply the Squid migration.");
  return data?.stripe_account_id as string | undefined;
}
export function isDirectAccount(account: Stripe.Account) {
  return (
    account.controller?.losses?.payments === "stripe" &&
    account.controller?.fees?.payer === "account" &&
    account.capabilities?.card_payments !== undefined
  );
}
export async function paymentOptions(accountId: string) {
  const account = await stripe().accounts.retrieve(accountId);
  return isDirectAccount(account) ? { stripeAccount: accountId } : {};
}
export async function payoutStatus(hostId: string) {
  const id = await hostAccount(hostId);
  if (!id || !process.env.STRIPE_SECRET_KEY) return { id, ready: false };
  const account = await stripe().accounts.retrieve(id);
  // A legacy destination-charge recipient must re-onboard before new charging.
  if (!isDirectAccount(account)) return { id: undefined, ready: false };
  return {
    id,
    ready:
      account.capabilities?.card_payments === "active" &&
      account.charges_enabled &&
      account.payouts_enabled,
  };
}
export async function onboarding(
  hostId: string,
  email: string,
  propertyId?: string,
  origin = appUrl(),
) {
  return withLock(`host:${hostId}`, async () => {
    let id = await hostAccount(hostId);
    if (id) {
      try {
        if (!isDirectAccount(await stripe().accounts.retrieve(id)))
          id = undefined;
      } catch (error) {
        connectFailure("account", error);
      }
    }
    if (!id) {
      // A new key avoids cached failures from the old account configurations.
      const key = `squid:connect:${hostId}:managed-risk:v1`;
      let account: { id: string };
      try {
        account = await durable(
          key,
          { hostId, email },
          async () => {
            const created = await stripe().v2.core.accounts.create(
              {
                contact_email: email,
                dashboard: "express",
                identity: { country: "US" },
                configuration: {
                  merchant: {
                    capabilities: { card_payments: { requested: true } },
                  },
                },
                defaults: {
                  responsibilities: {
                    fees_collector: "stripe",
                    losses_collector: "stripe",
                  },
                  profile: {
                    product_description:
                      "Electric vehicle charging at vacation rentals",
                  },
                },
                metadata: { squid_host_id: hostId },
              },
              { apiVersion: "2026-08-26.preview", idempotencyKey: key },
            );
            return { id: created.id };
          },
          true,
        );
      } catch (error) {
        // Stripe has confirmed that no account was created. Let the host retry
        // after platform activation without inheriting a stale saved request.
        if (
          error instanceof Stripe.errors.StripeError &&
          error.code === "account_create_activation_required"
        )
          await forget(key);
        connectFailure("account", error);
      }
      id = account.id;
      checked(
        await db()
          .from("squid_hosts")
          .upsert({ id: hostId, stripe_account_id: id }),
      );
    }
    const returnUrl = `${origin}/dashboard?${propertyId ? `setup=${encodeURIComponent(propertyId)}` : "tab=settings"}`;
    try {
      const link = await stripe().accountLinks.create({
        account: id,
        type: "account_onboarding",
        refresh_url: returnUrl,
        return_url: returnUrl,
      });
      return link.url;
    } catch (error) {
      connectFailure("link", error);
    }
  });
}
