"use client";
import { Brand } from "@/components/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="setup-page">
      <Brand />
      <h1>A small interruption.</h1>
      <p>
        We couldn’t load this page. Please try again. If a payment or charger
        action was in progress, Squid will check the original request.
      </p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
