"use client";
import { useCallback, useEffect, useState } from "react";
import { Eye, Mail, PenLine, Plus, Send, ShieldCheck } from "lucide-react";
import type {
  NewsletterIssue,
  NewsletterOverview,
  NewsletterPreview,
} from "@/lib/admin-types";
import { Busy, ErrorMessage, Modal, post } from "./ui";

const statusLabels: Record<NewsletterIssue["status"], string> = {
  draft: "Draft",
  approved: "Approved",
  sending: "Sending",
  sent: "Sent",
};
function date(value: string) {
  return (
    new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}
export function AdminNewsletter({ actorEmail }: { actorEmail: string }) {
  const [overview, setOverview] = useState<NewsletterOverview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<{
    id?: string;
    title: string;
    body: string;
  } | null>(null);
  const [preview, setPreview] = useState<{
    issue: NewsletterIssue;
    content: NewsletterPreview;
  } | null>(null);
  const [confirmSend, setConfirmSend] = useState<NewsletterIssue | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/newsletter", {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not load the newsletter.");
      setOverview(result);
      return result as NewsletterOverview;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not load the newsletter.",
      );
      return null;
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  async function run<T>(key: string, action: () => Promise<T>, done = "") {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (done) setNotice(done);
      await load();
      return result;
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Something went wrong.",
      );
      return null;
    } finally {
      setBusy("");
    }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const { id, title, body } = editing;
    const ok = await run(
      "save",
      () =>
        id
          ? post(`/api/admin/newsletter/${id}`, { action: "save", title, body })
          : post("/api/admin/newsletter", { title, body }),
      "Draft saved. Preview it and send yourself a test before approving.",
    );
    if (ok) setEditing(null);
  }
  async function openPreview(issue: NewsletterIssue) {
    const content = await run("preview", () =>
      post<NewsletterPreview>(`/api/admin/newsletter/${issue.id}`, {
        action: "preview",
      }),
    );
    if (content) setPreview({ issue, content });
  }
  async function sendTest() {
    if (!preview) return;
    const ok = await run(
      "test",
      () =>
        post(`/api/admin/newsletter/${preview.issue.id}`, { action: "test" }),
      `Test sent to ${actorEmail}. Check it, then approve.`,
    );
    if (ok)
      setPreview((value) =>
        value
          ? {
              ...value,
              issue: { ...value.issue, test_sent_at: new Date().toISOString() },
            }
          : value,
      );
  }
  async function approve() {
    if (!preview) return;
    const ok = await run(
      "approve",
      () =>
        post(`/api/admin/newsletter/${preview.issue.id}`, {
          action: "approve",
          hash: preview.content.hash,
        }),
      "Issue approved. It is ready to send.",
    );
    if (ok) setPreview(null);
  }
  async function send() {
    if (!confirmSend) return;
    const result = await run("send", () =>
      post<{ recipients: number; sent: number; done: boolean }>(
        `/api/admin/newsletter/${confirmSend.id}`,
        { action: "send" },
      ),
    );
    if (result) {
      setNotice(
        result.done
          ? `Sent to ${result.sent} of ${result.recipients} hosts.`
          : `Sending to ${result.recipients} hosts. ${result.sent} sent so far; the rest continue automatically.`,
      );
      setConfirmSend(null);
    }
  }
  if (!overview)
    return error ? (
      <ErrorMessage message={error} />
    ) : (
      <p className="admin-loading" role="status">
        <Busy>Loading…</Busy>
      </p>
    );
  const sending = overview.sending;
  return (
    <div className="admin-newsletter">
      <div className="notice">
        <Mail size={18} />
        <div>
          <strong>
            {sending.enabled && !sending.missing.length
              ? "Sending is enabled."
              : "Sending is off."}
          </strong>{" "}
          {overview.audience.toLocaleString()} host
          {overview.audience === 1 ? " has" : "s have"} opted in. Every issue
          needs a test send and your approval before it can go out.
          {!sending.enabled &&
            " Set NEWSLETTER_SENDING_ENABLED=true once DKIM and DMARC are in place."}
          {sending.enabled &&
            sending.missing.length > 0 &&
            ` Missing configuration: ${sending.missing.join(", ")}.`}
        </div>
      </div>
      <ErrorMessage message={error} />
      {notice && (
        <p className="success-message" role="status">
          {notice}
        </p>
      )}
      {editing ? (
        <form className="stack-form panel newsletter-editor" onSubmit={save}>
          <label>
            Title
            <input
              required
              minLength={3}
              maxLength={120}
              value={editing.title}
              onChange={(event) =>
                setEditing({ ...editing, title: event.target.value })
              }
            />
          </label>
          <label>
            Body
            <textarea
              required
              minLength={3}
              maxLength={20000}
              rows={14}
              value={editing.body}
              onChange={(event) =>
                setEditing({ ...editing, body: event.target.value })
              }
            />
          </label>
          <p className="fine-print">
            Plain text. Leave a blank line between paragraphs. Add links as
            [label](https://www.squidcharge.io/page); other sites are not
            allowed. Editing an approved issue returns it to draft.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button subtle"
              disabled={busy === "save"}
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy === "save"}>
              {busy === "save" ? <Busy>Saving…</Busy> : "Save draft"}
            </button>
          </div>
        </form>
      ) : (
        <button
          className="button secondary"
          onClick={() => setEditing({ title: "", body: "" })}
        >
          <Plus size={16} /> New issue
        </button>
      )}
      {overview.issues.length ? (
        <div className="admin-feedback-list">
          {overview.issues.map((issue) => (
            <article className="admin-feedback-item" key={issue.id}>
              <div className="admin-feedback-top">
                <div>
                  <span
                    className={`badge ${issue.status === "sent" || issue.status === "approved" ? "green-badge" : "neutral-badge"}`}
                  >
                    {statusLabels[issue.status]}
                  </span>
                  <small>
                    {issue.sent_at
                      ? `Sent ${date(issue.sent_at)}`
                      : issue.approved_at
                        ? `Approved ${date(issue.approved_at)}`
                        : issue.test_sent_at
                          ? `Test sent ${date(issue.test_sent_at)}`
                          : `Updated ${date(issue.updated_at)}`}
                  </small>
                </div>
              </div>
              <h3>{issue.title}</h3>
              {(issue.status === "sending" || issue.status === "sent") && (
                <dl className="newsletter-stats">
                  {(
                    [
                      ["Sent", `${issue.sent} / ${issue.recipients}`],
                      ["Bounced", issue.bounced],
                      ["Unsubscribed", issue.unsubscribed],
                      ["Clicks", issue.clicks],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="admin-feedback-meta">
                {(issue.status === "draft" || issue.status === "approved") && (
                  <>
                    <button
                      className="button subtle small-button"
                      onClick={() =>
                        setEditing({
                          id: issue.id,
                          title: issue.title,
                          body: issue.body,
                        })
                      }
                    >
                      <PenLine size={14} /> Edit
                    </button>
                    <button
                      className="button secondary small-button"
                      disabled={busy === "preview"}
                      onClick={() => openPreview(issue)}
                    >
                      <Eye size={14} />
                      {issue.status === "draft"
                        ? "Preview, test & approve"
                        : "Preview"}
                    </button>
                  </>
                )}
                {issue.status === "approved" && (
                  <button
                    className="button primary small-button"
                    disabled={!sending.enabled || sending.missing.length > 0}
                    onClick={() => setConfirmSend(issue)}
                  >
                    <Send size={14} /> Send
                  </button>
                )}
                {issue.status === "sending" && (
                  <span>Sending continues automatically every minute.</span>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="admin-empty">
          <Mail size={28} />
          <h3>No issues yet.</h3>
          <p>Write the first weekly note for Squid hosts.</p>
        </div>
      )}
      {preview && (
        <Modal
          title={preview.content.subject}
          wide
          feedback={false}
          onClose={() => {
            if (!busy) setPreview(null);
          }}
        >
          <iframe
            className="newsletter-preview"
            title="Newsletter preview"
            sandbox=""
            srcDoc={preview.content.html}
          />
          {preview.issue.status === "draft" && (
            <>
              <p className="fine-print">
                Send a test to {actorEmail}, check it in your inbox, then
                approve. Approval covers exactly this content.
              </p>
              <div className="form-actions">
                <button
                  className="button secondary"
                  disabled={Boolean(busy) || !sending.enabled}
                  onClick={sendTest}
                >
                  {busy === "test" ? (
                    <Busy>Sending test…</Busy>
                  ) : (
                    <>
                      <Mail size={16} /> Send test to me
                    </>
                  )}
                </button>
                <button
                  className="button primary"
                  disabled={Boolean(busy) || !preview.issue.test_sent_at}
                  onClick={approve}
                >
                  {busy === "approve" ? (
                    <Busy>Approving…</Busy>
                  ) : (
                    <>
                      <ShieldCheck size={16} /> Approve
                    </>
                  )}
                </button>
              </div>
            </>
          )}
          <ErrorMessage message={error} />
        </Modal>
      )}
      {confirmSend && (
        <Modal
          title="Send this issue?"
          feedback={false}
          onClose={() => {
            if (!busy) setConfirmSend(null);
          }}
        >
          <p className="modal-description">
            Send <strong>{confirmSend.title}</strong> to{" "}
            {overview.audience.toLocaleString()} opted-in host
            {overview.audience === 1 ? "" : "s"}. Hosts who unsubscribe or
            bounce before their turn are skipped. This can’t be undone.
          </p>
          <ErrorMessage message={error} />
          <div className="form-actions">
            <button
              className="button subtle"
              disabled={busy === "send"}
              onClick={() => setConfirmSend(null)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy === "send"}
              onClick={send}
            >
              {busy === "send" ? (
                <Busy>Sending…</Busy>
              ) : (
                <>
                  <Send size={16} /> Send now
                </>
              )}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
