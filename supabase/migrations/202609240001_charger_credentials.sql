begin;
create table public.squid_charger_credentials (
  property_id uuid primary key references public.squid_properties(id) on delete cascade,
  encrypted_password text not null,
  configured boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.squid_charger_credentials enable row level security;
revoke all on public.squid_charger_credentials from public, anon, authenticated;
grant all on public.squid_charger_credentials to service_role;
commit;
