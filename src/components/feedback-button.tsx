"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Check, MessageSquare, Star } from "lucide-react";
import { Busy, ErrorMessage, Modal, post } from "./ui";

const ratings = ["Not great", "Could be better", "Okay", "Good", "Great"];
export function FeedbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("other");
  const [rating, setRating] = useState<number | null>(null);
  const [website, setWebsite] = useState("");
  const sourcePage = useRef("/");
  const attempt = useRef<{ id: string; signature: string } | null>(null);
  function show() {
    if (sent) {
      setSent(false);
      setMessage("");
      setEmail("");
      setRating(null);
      setCategory("other");
      setError("");
      attempt.current = null;
    }
    sourcePage.current = window.location.pathname;
    setOpen(true);
  }
  useEffect(() => {
    window.addEventListener("squid:feedback", show);
    return () => window.removeEventListener("squid:feedback", show);
  });
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const body = {
      category,
      rating,
      message: message.trim(),
      email: email.trim(),
      page: sourcePage.current,
      website,
    };
    const signature = JSON.stringify(body);
    if (attempt.current?.signature !== signature)
      attempt.current = { id: crypto.randomUUID(), signature };
    setBusy(true);
    setError("");
    try {
      await post("/api/feedback", { ...body, id: attempt.current.id });
      setSent(true);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not send your feedback. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className={`feedback-launcher ${pathname === "/dashboard" || pathname === "/demo" ? "feedback-above-nav" : ""} ${pathname.startsWith("/c/") || pathname.startsWith("/session/") ? "feedback-charging-page" : ""}`}
        onClick={show}
        aria-haspopup="dialog"
        title="Share feedback to help Squid grow"
      >
        <MessageSquare size={17} /> <span>Feedback</span>
      </button>
      {open && (
        <Modal
          title="Help Squid grow"
          onClose={() => setOpen(false)}
          feedback={false}
        >
          <div className="ph-no-capture ph-mask">
            {sent ? (
              <div className="feedback-thanks" role="status">
                <div className="round-icon">
                  <Check size={22} />
                </div>
                <h3>Thanks for helping Squid grow.</h3>
                <p>Your feedback is with the Squid team.</p>
                <button
                  className="button primary full"
                  onClick={() => setOpen(false)}
                >
                  Done
                </button>
              </div>
            ) : (
              <form className="stack-form" onSubmit={submit}>
                <p className="modal-description">
                  A small idea can make a big difference. Tell us what’s working
                  or what we can improve.
                </p>
                <fieldset className="feedback-rating">
                  <legend>
                    How’s your experience? <span>(optional)</span>
                  </legend>
                  <div className="feedback-stars">
                    {ratings.map((label, i) => (
                      <label key={label} title={label}>
                        <input
                          type="radio"
                          name="experience"
                          aria-label={`${i + 1} — ${label}`}
                          checked={rating === i + 1}
                          onChange={() => setRating(i + 1)}
                        />
                        <Star
                          size={25}
                          fill={
                            rating !== null && rating >= i + 1
                              ? "currentColor"
                              : "none"
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <div className="feedback-rating-labels">
                    <span>Not great</span>
                    <span>Great</span>
                  </div>
                  {rating !== null && (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => setRating(null)}
                    >
                      Clear rating
                    </button>
                  )}
                </fieldset>
                <label>
                  What would you like to share?
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                  >
                    <option value="other">General feedback</option>
                    <option value="issue">Something isn’t working</option>
                    <option value="idea">An idea or suggestion</option>
                  </select>
                </label>
                <label>
                  Your feedback
                  <textarea
                    name="feedback"
                    required
                    minLength={3}
                    maxLength={2000}
                    rows={4}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="What would make Squid better for you?"
                  />
                </label>
                <label>
                  Email <span className="muted">(optional)</span>
                  <input
                    type="email"
                    name="email"
                    maxLength={254}
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                  />
                  <small className="fine-print">
                    Only if you’d like us to follow up. You can leave this
                    blank.
                  </small>
                </label>
                <label className="feedback-honeypot" aria-hidden="true">
                  Your website
                  <input
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(event) => setWebsite(event.target.value)}
                  />
                </label>
                <ErrorMessage message={error} />
                <button className="button primary full" disabled={busy}>
                  {busy ? <Busy>Sending…</Busy> : "Send feedback"}
                </button>
              </form>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
