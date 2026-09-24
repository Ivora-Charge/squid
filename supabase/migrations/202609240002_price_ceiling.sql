begin;
-- Hosts may set any positive price per kWh. The initial schema capped
-- rate_cents at 500 ($5.00); drop that check however it was named.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.squid_properties'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%rate_cents%'
  loop
    execute format('alter table public.squid_properties drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.squid_properties
  add constraint squid_properties_rate_cents_check check (rate_cents >= 1);
commit;
