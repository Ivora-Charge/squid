"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  LogOut,
  MessageSquare,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";
import type {
  AdminAudit,
  AdminSummary,
  Feedback,
  FeedbackStatus,
  Tenant,
} from "@/lib/admin-types";
import { Brand, Busy, ErrorMessage, Modal, post } from "./ui";

type View = "tenants" | "feedback" | "audit";
type Result = {
  summary: AdminSummary;
  total: number;
  tenants?: Tenant[];
  feedback?: Feedback[];
  audit?: AdminAudit[];
};
function date(value: string) {
  return (
    new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}
const eventLabels: Record<AdminAudit["event"], string> = {
  access_started: "Tenant access started",
  access_ended: "Tenant access ended",
  tenant_request: "Tenant action requested",
  feedback_updated: "Feedback status changed",
};
export function AdminDashboard({
  actor,
  initial,
}: {
  actor: { id: string; email: string };
  initial: { summary: AdminSummary; tenants: Tenant[]; total: number };
}) {
  const [view, setView] = useState<View>("tenants");
  const [summary, setSummary] = useState(initial.summary);
  const [tenants, setTenants] = useState(initial.tenants);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [audit, setAudit] = useState<AdminAudit[]>([]);
  const [total, setTotal] = useState(initial.total);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | FeedbackStatus>("all");
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [selected, setSelected] = useState<Tenant | null>(null);
  const [reason, setReason] = useState("Support and troubleshooting");
  const [entering, setEntering] = useState(false);
  const [accessError, setAccessError] = useState("");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(
      async () => {
        try {
          const params = new URLSearchParams({
            view,
            page: String(page),
            search,
            status,
          });
          const response = await fetch(`/api/admin/data?${params}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          const result = (await response.json()) as Result & { error?: string };
          if (!response.ok)
            throw new Error(result.error || "Could not load admin data.");
          if (controller.signal.aborted) return;
          setSummary(result.summary);
          setTotal(result.total);
          if (result.tenants) setTenants(result.tenants);
          if (result.feedback) setFeedback(result.feedback);
          if (result.audit) setAudit(result.audit);
        } catch (error) {
          if (!controller.signal.aborted)
            setError(
              error instanceof Error
                ? error.message
                : "Could not load admin data.",
            );
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      search ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [view, page, search, status, reload]);
  function switchView(next: View) {
    setView(next);
    setPage(0);
    setError("");
  }
  function findTenant(id: string) {
    setSearch(id);
    setPage(0);
    setView("tenants");
  }
  async function updateStatus(item: Feedback, value: FeedbackStatus) {
    setUpdating(item.id);
    setError("");
    try {
      await post(`/api/admin/feedback/${item.id}`, { status: value });
      setReload((value) => value + 1);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not update feedback.",
      );
    } finally {
      setUpdating(null);
    }
  }
  async function ownWorkspace() {
    setError("");
    try {
      await post("/api/admin/tenant-access", { action: "end" });
      window.location.assign("/dashboard");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not open your workspace.",
      );
    }
  }
  async function signOut() {
    setError("");
    try {
      await post("/auth/logout", {});
      window.location.assign("/login");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not sign out.");
    }
  }
  async function enter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || entering) return;
    setEntering(true);
    setAccessError("");
    try {
      await post("/api/admin/tenant-access", {
        action: "start",
        tenantId: selected.id,
        reason,
      });
      window.location.assign("/dashboard");
    } catch (error) {
      setAccessError(
        error instanceof Error ? error.message : "Could not open this tenant.",
      );
      setEntering(false);
    }
  }
  return (
    <div className="admin-page ph-no-capture ph-mask">
      <header className="admin-header">
        <Brand />
        <span className="admin-label">
          <ShieldCheck size={16} /> Admin
        </span>
        <div className="admin-header-actions">
          <button className="text-link" onClick={ownWorkspace}>
            Host workspace <ArrowRight size={15} />
          </button>
          <button
            className="icon-button"
            onClick={signOut}
            aria-label="Sign out"
          >
            <LogOut size={19} />
          </button>
        </div>
      </header>
      <main id="main">
        <div className="admin-heading">
          <div>
            <p className="eyebrow">SQUID OPERATIONS</p>
            <h1>A little oversight.</h1>
            <p>
              Manage tenants, listen to feedback, and help hosts get charging.
            </p>
          </div>
          <button
            className="button subtle"
            onClick={() => setReload((value) => value + 1)}
            disabled={loading}
          >
            {loading ? <Busy /> : <RefreshCw size={16} />} Refresh
          </button>
        </div>
        <p className="admin-account">Signed in as {actor.email}</p>
        <div className="admin-metrics">
          {[
            { label: "Tenants", value: summary.tenants, icon: Users },
            { label: "Chargers", value: summary.chargers, icon: Plug },
            {
              label: "Active sessions",
              value: summary.active_sessions,
              icon: Zap,
            },
            {
              label: "New feedback",
              value: summary.new_feedback,
              icon: MessageSquare,
            },
          ].map((item) => (
            <div key={item.label} className="admin-metric">
              <span>
                {item.label}
                <item.icon size={18} />
              </span>
              <strong>{item.value.toLocaleString()}</strong>
            </div>
          ))}
        </div>
        <nav className="admin-tabs" aria-label="Admin sections">
          {(["tenants", "feedback", "audit"] as const).map((tab) => (
            <button
              key={tab}
              className={view === tab ? "active" : ""}
              aria-pressed={view === tab}
              onClick={() => switchView(tab)}
            >
              {tab === "tenants"
                ? "Tenants"
                : tab === "feedback"
                  ? "Feedback"
                  : "Activity log"}
              {tab === "feedback" && summary.new_feedback > 0 && (
                <span className="count-pill">{summary.new_feedback}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="admin-toolbar">
          <div>
            <h2>
              {view === "tenants"
                ? "Host workspaces"
                : view === "feedback"
                  ? "Help Squid grow"
                  : "Admin activity"}
            </h2>
            <p>
              {view === "tenants"
                ? "Find a host and work in their tenant dashboard."
                : view === "feedback"
                  ? "Ideas, issues, and feedback from across Squid."
                  : "Tenant access, action requests, and feedback updates."}
            </p>
          </div>
          {view === "tenants" && (
            <div className="search-field admin-search">
              <Search size={17} />
              <input
                aria-label="Search tenants"
                placeholder="Email, charger, or city…"
                maxLength={100}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </div>
          )}
          {view === "feedback" && (
            <label className="admin-status-filter">
              Status
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as typeof status);
                  setPage(0);
                }}
              >
                <option value="all">All feedback</option>
                <option value="new">New</option>
                <option value="reviewing">Reviewing</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
          )}
        </div>
        <ErrorMessage message={error} />
        {loading && (
          <p className="admin-loading" role="status">
            <Busy>Loading…</Busy>
          </p>
        )}
        <section
          className="admin-results"
          aria-busy={loading}
          aria-label={
            view === "tenants"
              ? "Tenants"
              : view === "feedback"
                ? "Feedback"
                : "Activity log"
          }
        >
          {view === "tenants" &&
            (tenants.length ? (
              <table className="admin-tenants">
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Chargers</th>
                    <th>Sessions</th>
                    <th>Payouts</th>
                    <th>Workspace</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant) => (
                    <tr key={tenant.id}>
                      <td>
                        <strong className="admin-tenant-email">
                          {tenant.email}
                        </strong>
                        <small>
                          {tenant.confirmed
                            ? "Email confirmed"
                            : "Awaiting email confirmation"}
                        </small>
                      </td>
                      <td data-label="Chargers">
                        {tenant.chargers}
                        <small>{tenant.published_chargers} published</small>
                      </td>
                      <td data-label="Sessions">{tenant.sessions}</td>
                      <td data-label="Payouts">
                        <span
                          className={`badge ${tenant.stripe_connected ? "green-badge" : "neutral-badge"}`}
                        >
                          {tenant.stripe_connected
                            ? "Stripe connected"
                            : "Not connected"}
                        </span>
                      </td>
                      <td>
                        {tenant.id === actor.id ? (
                          <button
                            className="button subtle small-button"
                            onClick={ownWorkspace}
                          >
                            Your workspace <ArrowRight size={14} />
                          </button>
                        ) : (
                          <button
                            className="button secondary small-button"
                            onClick={() => {
                              setSelected(tenant);
                              setReason("Support and troubleshooting");
                              setAccessError("");
                            }}
                          >
                            Act as tenant <ArrowRight size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="admin-empty">
                <Users size={28} />
                <h3>No tenants found.</h3>
                <p>
                  {search
                    ? "Try another email, charger name, or city."
                    : "Host accounts will appear here when they sign up."}
                </p>
              </div>
            ))}
          {view === "feedback" &&
            (feedback.length ? (
              <div className="admin-feedback-list">
                {feedback.map((item) => (
                  <article className="admin-feedback-item" key={item.id}>
                    <div className="admin-feedback-top">
                      <div>
                        <span className="badge neutral-badge">
                          {item.category === "issue"
                            ? "Issue"
                            : item.category === "idea"
                              ? "Idea"
                              : "General feedback"}
                        </span>
                        {item.rating && (
                          <span className="admin-rating">
                            {item.rating}/5 experience
                          </span>
                        )}
                        <small>{date(item.created_at)}</small>
                      </div>
                      <label>
                        Status
                        <select
                          aria-label={`Feedback status for ${item.id}`}
                          value={item.status}
                          disabled={updating === item.id}
                          onChange={(event) =>
                            updateStatus(
                              item,
                              event.target.value as FeedbackStatus,
                            )
                          }
                        >
                          <option value="new">New</option>
                          <option value="reviewing">Reviewing</option>
                          <option value="resolved">Resolved</option>
                        </select>
                      </label>
                    </div>
                    <p className="admin-feedback-message">{item.message}</p>
                    <div className="admin-feedback-meta">
                      <span>From {item.page_path}</span>
                      {item.email ? (
                        <a href={`mailto:${item.email}`}>{item.email}</a>
                      ) : (
                        <span>No email provided</span>
                      )}
                      {item.tenant_id && (
                        <button
                          className="text-link"
                          onClick={() => findTenant(item.tenant_id!)}
                        >
                          Find tenant <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="admin-empty">
                <MessageSquare size={28} />
                <h3>
                  {status === "all"
                    ? "Room for a little feedback."
                    : "No feedback with this status."}
                </h3>
                <p>
                  Messages submitted through “Help Squid grow” will appear here.
                </p>
              </div>
            ))}
          {view === "audit" &&
            (audit.length ? (
              <div className="admin-audit-list">
                {audit.map((item) => (
                  <article key={item.id} className="admin-audit-item">
                    <div>
                      <ShieldCheck size={18} />
                      <strong>{eventLabels[item.event]}</strong>
                      <small>{date(item.created_at)}</small>
                    </div>
                    <p>
                      {item.reason ??
                        (item.method && item.path
                          ? `${item.method} ${item.path}`
                          : "Admin action")}
                      {item.tenant_id && (
                        <button
                          className="text-link"
                          onClick={() => findTenant(item.tenant_id!)}
                        >
                          Find tenant <ArrowRight size={14} />
                        </button>
                      )}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="admin-empty">
                <ShieldCheck size={28} />
                <h3>No admin activity yet.</h3>
                <p>
                  Tenant access and admin action requests are recorded here.
                </p>
              </div>
            ))}
        </section>
        <div className="admin-pagination">
          <span>
            {total
              ? `${page * 25 + 1}–${Math.min((page + 1) * 25, total)} of ${total}`
              : "0 results"}
          </span>
          <div>
            <button
              className="button subtle small-button"
              disabled={page === 0 || loading}
              onClick={() => setPage((value) => value - 1)}
            >
              <ArrowLeft size={14} /> Previous
            </button>
            <button
              className="button subtle small-button"
              disabled={(page + 1) * 25 >= total || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Next <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </main>
      {selected && (
        <Modal
          title="Act as tenant"
          onClose={() => {
            if (!entering) setSelected(null);
          }}
        >
          <form className="stack-form" onSubmit={enter}>
            <p className="modal-description">
              Open <strong>{selected.email}</strong>’s workspace for up to one
              hour. Your tenant actions are recorded in the activity log.
            </p>
            <label>
              Reason for access
              <input
                required
                minLength={3}
                maxLength={240}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <ErrorMessage message={accessError} />
            <div className="form-actions">
              <button
                type="button"
                className="button subtle"
                disabled={entering}
                onClick={() => setSelected(null)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={entering}>
                {entering ? (
                  <Busy>Opening…</Busy>
                ) : (
                  <>
                    Act as tenant <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
