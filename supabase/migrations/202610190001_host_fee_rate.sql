begin;
-- Squid's application fee is stored per host in basis points. Hosts created
-- from now on pay 10% (1000); every host that already exists keeps 6% (600).
-- Squid stores a host row only once payout setup starts, so accounts that
-- signed up earlier but have not connected Stripe yet also receive a 600 row.
-- The backfill runs only when the column is first added, so applying this file
-- again can never move a newer host to 6%.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'squid_hosts'
      and column_name = 'fee_basis_points'
  ) then
    alter table public.squid_hosts
      add column fee_basis_points integer not null default 600;
    insert into public.squid_hosts(id, fee_basis_points)
      select u.id, 600 from auth.users u
      on conflict (id) do nothing;
    alter table public.squid_hosts
      alter column fee_basis_points set default 1000;
  end if;
end
$$;
alter table public.squid_hosts drop constraint if exists squid_hosts_fee_basis_points_check;
alter table public.squid_hosts
  add constraint squid_hosts_fee_basis_points_check check (fee_basis_points in (600, 1000));

-- Each session snapshots its host's rate at checkout. Every session created
-- before this migration was charged 6%, and the default keeps sessions created
-- by a deployment that predates this column at 6% as well.
alter table public.squid_sessions
  add column if not exists fee_basis_points integer not null default 600;
alter table public.squid_sessions drop constraint if exists squid_sessions_fee_basis_points_check;
alter table public.squid_sessions
  add constraint squid_sessions_fee_basis_points_check check (fee_basis_points in (600, 1000));
grant select(fee_basis_points) on public.squid_sessions to authenticated;
commit;
