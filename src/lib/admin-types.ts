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
