export type Tenant = {
  id: string;
  email: string;
  created_at: string;
  confirmed: boolean;
  chargers: number;
  published_chargers: number;
  sessions: number;
  stripe_connected: boolean;
};
export type FeedbackStatus = "new" | "reviewing" | "resolved";
export type Feedback = {
  id: string;
  submitted_by: string | null;
  tenant_id: string | null;
  email: string | null;
  category: "issue" | "idea" | "other";
  rating: number | null;
  message: string;
  page_path: string;
  status: FeedbackStatus;
  created_at: string;
};
export type AdminAudit = {
  id: string;
  actor_id: string;
  tenant_id: string | null;
  access_id: string | null;
  subject_id: string | null;
  event:
    | "access_started"
    | "access_ended"
    | "tenant_request"
    | "feedback_updated";
  method: string | null;
  path: string | null;
  reason: string | null;
  created_at: string;
};
export type AdminSummary = {
  tenants: number;
  chargers: number;
  active_sessions: number;
  new_feedback: number;
};
export type ActingAs = { id: string; email: string; expiresAt: string };
export type NewsletterStatus = "draft" | "approved" | "sending" | "sent";
export type NewsletterIssue = {
  id: string;
  title: string;
  body: string;
  status: NewsletterStatus;
  created_at: string;
  updated_at: string;
  test_sent_at: string | null;
  approved_at: string | null;
  send_started_at: string | null;
  sent_at: string | null;
  recipients: number;
  sent: number;
  bounced: number;
  unsubscribed: number;
  clicks: number;
};
export type NewsletterOverview = {
  audience: number;
  issues: NewsletterIssue[];
  sending: { enabled: boolean; missing: string[] };
};
export type NewsletterPreview = {
  subject: string;
  html: string;
  text: string;
  hash: string;
};
