begin;
-- Stripe's processing fee is passed through to hosts inside the Connect
-- application fee. Record the amount per session so earnings stay exact.
alter table public.squid_sessions
  add column if not exists stripe_fee_cents integer check (stripe_fee_cents >= 0);
grant select(stripe_fee_cents) on public.squid_sessions to authenticated;
commit;
