begin;

create table if not exists public.squid_hosts (
  id uuid primary key references auth.users(id) on delete cascade,
  stripe_account_id text unique,
  created_at timestamptz not null default now()
);
create table if not exists public.squid_properties (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique default replace(gen_random_uuid()::text, '-', ''),
  address text not null,
  city text not null,
  state text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  time_zone text not null default 'America/New_York',
  instructions text not null default 'Park by the charger, plug in, and follow the steps below.',
  connector_type text not null default 'J1772',
  max_kw numeric not null default 7.2 check (max_kw > 0 and max_kw <= 22),
  rate_cents integer not null check (rate_cents between 1 and 500),
  hold_cents integer not null default 2500 check (hold_cents between 500 and 10000),
  station_name text not null unique,
  location_id bigint,
  station_id bigint unique,
  connector_id bigint unique,
  tariff_id bigint,
  ocpp_url text,
  published boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists squid_properties_host on public.squid_properties(host_id);
create table if not exists public.squid_sessions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  property_id uuid not null references public.squid_properties(id),
  host_id uuid not null references auth.users(id),
  stripe_account_id text not null,
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment','starting','charging','stopping','settling','completed','canceled','refunded','review')),
  rate_cents integer not null,
  hold_cents integer not null,
  tariff_id bigint not null,
  stripe_checkout_id text unique,
  stripe_payment_id text unique,
  checkout_url text,
  ivora_session_id text unique,
  energy_kwh numeric not null default 0,
  total_cents integer,
  fee_cents integer,
  stop_requested boolean not null default false,
  refund_requested boolean not null default false,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);
create index if not exists squid_sessions_host on public.squid_sessions(host_id,created_at desc);
create unique index if not exists squid_one_active_session on public.squid_sessions(property_id)
  where status not in ('completed','canceled','refunded');
create table if not exists public.squid_operations (
  key text primary key,
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.squid_locks (
  key text primary key,
  owner uuid not null,
  expires_at timestamptz not null
);
create or replace function public.squid_claim_lock(lock_key text, lock_owner uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into squid_locks(key,owner,expires_at) values(lock_key,lock_owner,now()+interval '90 seconds')
  on conflict(key) do update set owner=excluded.owner, expires_at=excluded.expires_at
  where squid_locks.expires_at < now();
  return found;
end;
$$;
revoke all on function public.squid_claim_lock(text,uuid) from public,anon,authenticated;
grant execute on function public.squid_claim_lock(text,uuid) to service_role;

alter table public.squid_hosts enable row level security;
alter table public.squid_properties enable row level security;
alter table public.squid_sessions enable row level security;
alter table public.squid_operations enable row level security;
alter table public.squid_locks enable row level security;
-- No direct client writes. Every write goes through authenticated, validated server routes.
revoke all on public.squid_hosts,public.squid_properties,public.squid_sessions,public.squid_operations,public.squid_locks from anon,authenticated;
grant select on public.squid_hosts,public.squid_properties to authenticated;
grant select(id,property_id,host_id,status,rate_cents,energy_kwh,total_cents,fee_cents,created_at,started_at,ended_at) on public.squid_sessions to authenticated;
grant all on public.squid_hosts,public.squid_properties,public.squid_sessions,public.squid_operations,public.squid_locks to service_role;
create policy "Hosts read their profile" on public.squid_hosts for select to authenticated using (id = auth.uid());
create policy "Hosts read their properties" on public.squid_properties for select to authenticated using (host_id = auth.uid());
create policy "Hosts read their sessions" on public.squid_sessions for select to authenticated using (host_id = auth.uid());
commit;
