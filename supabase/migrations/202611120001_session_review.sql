begin;

-- Sessions in review: how many reconcile passes they have had (the per-minute
-- cron stops retrying after a bounded number) and when the host was told.
alter table public.squid_sessions
  add column if not exists review_attempts integer not null default 0,
  add column if not exists review_notified_at timestamptz;

commit;
