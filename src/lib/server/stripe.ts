import "server-only";
import Stripe from "stripe";
import { appUrl, required } from "./config";
import { checked, db, withLock } from "./db";
import { durable } from "./ivora";
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
export async function payoutStatus(hostId: string) {
  const id = await hostAccount(hostId);
  if (!id || !process.env.STRIPE_SECRET_KEY) return { id, ready: false };
  const account = await stripe().accounts.retrieve(id);
  return { id, ready: account.charges_enabled && account.payouts_enabled };
}
export async function onboarding(hostId: string, email: string) {
  return withLock(`host:${hostId}`, async () => {
    let id = await hostAccount(hostId);
    if (!id) {
      const key = `squid:connect:${hostId}`;
      const account = await durable(
        key,
        { hostId, email },
        async () => {
          const created = await stripe().accounts.create(
            {
              type: "express",
              country: "US",
              email,
              capabilities: {
                card_payments: { requested: true },
                transfers: { requested: true },
              },
              business_profile: {
                product_description:
                  "Electric vehicle charging at vacation rentals",
              },
              metadata: { squid_host_id: hostId },
            },
            { idempotencyKey: key },
          );
          return { id: created.id };
        },
        true,
      );
      id = account.id;
      checked(
        await db()
          .from("squid_hosts")
          .upsert({ id: hostId, stripe_account_id: id }),
      );
    }
    const link = await stripe().accountLinks.create({
      account: id,
      type: "account_onboarding",
      refresh_url: `${appUrl()}/dashboard?tab=settings`,
      return_url: `${appUrl()}/dashboard?tab=settings`,
    });
    return link.url;
  });
}
