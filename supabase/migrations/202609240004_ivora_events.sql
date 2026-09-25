begin;
-- Ivora webhook deliveries are at-least-once. Remember each event id so a
-- redelivery is acknowledged without reconciling twice.
create table public.squid_ivora_events (
  id text primary key,
  type text not null,
  resource_id text,
  received_at timestamptz not null default now()
);
create index if not exists squid_ivora_events_received on public.squid_ivora_events(received_at);
alter table public.squid_ivora_events enable row level security;
revoke all on public.squid_ivora_events from public, anon, authenticated;
grant all on public.squid_ivora_events to service_role;
commit;
