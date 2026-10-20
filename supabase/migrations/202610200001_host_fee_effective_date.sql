begin;
-- Squid's fee now follows from when a host's Squid account was created:
-- accounts created before NEW_HOST_FEE_EFFECTIVE_AT (default
-- 2026-11-01T00:00:00Z) pay 6%, accounts created on or after it pay 10%. The
-- application decides the rate from auth.users.created_at and keeps
-- squid_hosts.fee_basis_points in step; it never reads the stored value to
-- set a session's rate.
--
-- A row Squid saves without a rate must never pay 10% early, so the column
-- default becomes 6%. The application always writes the rate explicitly.
alter table public.squid_hosts
  alter column fee_basis_points set default 600;

-- Recompute every stored host rate from its account's creation time against
-- the default effective instant. This corrects rows created at the old 10%
-- default before the effective date, and rows backfilled at 6% for accounts
-- created after it. The result depends only on account creation times, never
-- on when this file runs, so it is safe before or after the effective date
-- and safe to apply twice. An operator who overrides the effective instant
-- gets each stored rate corrected by the application on the host's next
-- dashboard visit, payout setup, or checkout.
update public.squid_hosts h
set fee_basis_points = case
    when u.created_at < timestamptz '2026-11-01 00:00:00+00' then 600
    else 1000
  end
from auth.users u
where u.id = h.id
  and h.fee_basis_points is distinct from case
    when u.created_at < timestamptz '2026-11-01 00:00:00+00' then 600
    else 1000
  end;
commit;
