begin;

create table if not exists public.squid_rate_limits (
  key text primary key,
  attempts integer not null check (attempts > 0),
  resets_at timestamptz not null
);
create index if not exists squid_rate_limits_expiry on public.squid_rate_limits(resets_at);
alter table public.squid_rate_limits enable row level security;
revoke all on public.squid_rate_limits from public, anon, authenticated;
grant all on public.squid_rate_limits to service_role;

-- One atomic quota shared by every Vercel instance. Keys contain HMAC digests,
-- never plain email addresses or IP addresses.
create or replace function public.squid_take_rate_limit(bucket_key text, quota integer, period_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if quota < 1 or period_seconds < 1 then
    raise exception 'Invalid rate limit';
  end if;
  insert into squid_rate_limits(key, attempts, resets_at)
    values(bucket_key, 1, now() + make_interval(secs => period_seconds))
  on conflict(key) do update set
    attempts = case when squid_rate_limits.resets_at <= now() then 1 else squid_rate_limits.attempts + 1 end,
    resets_at = case when squid_rate_limits.resets_at <= now() then excluded.resets_at else squid_rate_limits.resets_at end
  where squid_rate_limits.resets_at <= now() or squid_rate_limits.attempts < quota;
  return found;
end;
$$;
revoke all on function public.squid_take_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.squid_take_rate_limit(text,integer,integer) to service_role;

commit;
