import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/server/stripe";
import { required } from "@/lib/server/config";
import { loadSession, reconcile } from "@/lib/server/sessions";
import type Stripe from "stripe";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature") || "";
  let event: Stripe.Event | undefined;
  // Stripe signs platform and connected-account deliveries with separate
  // endpoint secrets, even when both endpoints use this URL.
  for (const secret of [
    required("STRIPE_WEBHOOK_SECRET"),
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  ]) {
    if (!secret) continue;
    try {
      event = stripe().webhooks.constructEvent(body, signature, secret);
      break;
    } catch {
      // Try the other endpoint's signing secret.
    }
  }
  if (!event)
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 400 },
    );
  if (event.livemode !== required("STRIPE_SECRET_KEY").startsWith("sk_live_"))
    return NextResponse.json({ received: true });
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.expired"
  ) {
    const id = event.data.object.metadata?.squid_session_id;
    if (id) {
      try {
        const session = await loadSession(id);
        if (event.account && event.account !== session.stripe_account_id)
          return NextResponse.json({ received: true });
        await reconcile(id);
      } catch {
        return NextResponse.json(
          { error: "Retry reconciliation." },
          { status: 503 },
        );
      }
    }
  }
  return NextResponse.json({ received: true });
}
