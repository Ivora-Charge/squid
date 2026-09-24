import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/server/stripe";
import { required } from "@/lib/server/config";
import { reconcile } from "@/lib/server/sessions";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  let event;
  try {
    event = stripe().webhooks.constructEvent(
      await request.text(),
      request.headers.get("stripe-signature") || "",
      required("STRIPE_WEBHOOK_SECRET"),
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 400 },
    );
  }
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.expired"
  ) {
    const id = event.data.object.metadata?.squid_session_id;
    if (id) {
      try {
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
