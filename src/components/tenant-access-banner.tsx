"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { ActingAs } from "@/lib/admin-types";
import { Busy, ErrorMessage, post } from "./ui";

export function TenantAccessBanner({ access }: { access: ActingAs }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const remaining = Date.parse(access.expiresAt) - Date.now();
    const timer = setTimeout(
      () => window.location.assign("/admin?access=ended"),
      Math.max(remaining, 0),
    );
    return () => clearTimeout(timer);
  }, [access.expiresAt]);
  async function leave() {
    setBusy(true);
    setError("");
    try {
      await post("/api/admin/tenant-access", { action: "end" });
      window.location.assign("/admin");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not return to admin.",
      );
      setBusy(false);
    }
  }
  return (
    <aside
      className="tenant-access-banner ph-no-capture ph-mask"
      aria-label="Tenant access"
    >
      <div>
        <ShieldCheck size={20} />
        <span>
          <strong>Acting as {access.email}</strong>
          <small>Changes apply to this tenant’s workspace.</small>
        </span>
      </div>
      <button
        className="button subtle small-button"
        disabled={busy}
        onClick={leave}
      >
        {busy ? <Busy /> : <ArrowLeft size={15} />} Return to admin
      </button>
      <ErrorMessage message={error} />
    </aside>
  );
}
