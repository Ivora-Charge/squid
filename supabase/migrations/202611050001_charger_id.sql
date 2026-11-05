begin;

-- New chargers are registered with Ivora by charger_id (the charger's own OCPP
-- identity, unique within the project) and connect at their project address.
-- Chargers registered earlier by a global station name keep a null charger_id
-- and their current address. Additive: no existing row changes.
alter table public.squid_properties
  add column if not exists charger_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.squid_properties'::regclass
      and conname = 'squid_properties_charger_id_format'
  ) then
    alter table public.squid_properties
      add constraint squid_properties_charger_id_format
      check (charger_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$');
  end if;
end $$;

create unique index if not exists squid_properties_charger_id
  on public.squid_properties(charger_id);

commit;
