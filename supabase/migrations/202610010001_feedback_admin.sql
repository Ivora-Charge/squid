begin;

create table if not exists public.squid_feedback (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid references auth.users(id) on delete set null,
  tenant_id uuid references auth.users(id) on delete set null,
  email text check (email is null or char_length(email) between 3 and 254),
  category text not null check (category in ('issue','idea','other')),
  rating integer check (rating between 1 and 5),
  message text not null check (char_length(trim(message)) between 3 and 2000),
  page_path text not null check (char_length(page_path) between 1 and 200),
  status text not null default 'new' check (status in ('new','reviewing','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists squid_feedback_status_created on public.squid_feedback(status,created_at desc);

create table if not exists public.squid_tenant_access (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  reason text not null check (char_length(trim(reason)) between 3 and 240),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  ended_at timestamptz,
  check (actor_id <> tenant_id),
  check (expires_at > created_at and expires_at <= created_at + interval '1 hour')
);
create unique index if not exists squid_tenant_access_one_actor on public.squid_tenant_access(actor_id) where ended_at is null;

create table if not exists public.squid_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  tenant_id uuid,
  access_id uuid,
  subject_id uuid,
  event text not null check (event in ('access_started','access_ended','tenant_request','feedback_updated')),
  method text,
  path text check (char_length(path) <= 200),
  reason text check (char_length(reason) <= 240),
  created_at timestamptz not null default now()
);
create index if not exists squid_admin_audit_created on public.squid_admin_audit(created_at desc);

alter table public.squid_feedback enable row level security;
alter table public.squid_tenant_access enable row level security;
alter table public.squid_admin_audit enable row level security;
revoke all on public.squid_feedback,public.squid_tenant_access,public.squid_admin_audit from public,anon,authenticated,service_role;
grant select,insert,update on public.squid_feedback to service_role;
grant select on public.squid_tenant_access to service_role;
grant select,insert on public.squid_admin_audit to service_role;

-- These functions stay behind Squid's verified-admin routes. Browser roles
-- cannot call them or read any feedback, access tokens, or audit records.
create or replace function public.squid_admin_tenants(search_text text default '',page_offset integer default 0,page_limit integer default 25)
returns jsonb language sql stable security definer set search_path = public,pg_temp as $$
  with matching as (
    select u.id,u.email,u.created_at,(u.email_confirmed_at is not null) as confirmed
    from auth.users u
    where u.email is not null and (
      position(lower(trim(coalesce(search_text,''))) in lower(u.email)) > 0
      or position(lower(trim(coalesce(search_text,''))) in u.id::text) > 0
      or exists (
        select 1 from squid_properties p where p.host_id=u.id
        and position(lower(trim(coalesce(search_text,''))) in lower(p.name || ' ' || p.city)) > 0
      )
    )
  ), page as (
    select * from matching order by created_at desc,id
    offset greatest(page_offset,0) limit least(greatest(page_limit,1),100)
  ), enriched as (
    select page.*,
      (select count(*) from squid_properties p where p.host_id=page.id) as chargers,
      (select count(*) from squid_properties p where p.host_id=page.id and p.published) as published_chargers,
      (select count(*) from squid_sessions s where s.host_id=page.id) as sessions,
      exists(select 1 from squid_hosts h where h.id=page.id and h.stripe_account_id is not null) as stripe_connected
    from page
  )
  select jsonb_build_object(
    'total',(select count(*) from matching),
    'tenants',coalesce((select jsonb_agg(to_jsonb(enriched) order by created_at desc,id) from enriched),'[]'::jsonb)
  );
$$;

create or replace function public.squid_admin_summary()
returns jsonb language sql stable security definer set search_path = public,pg_temp as $$
  select jsonb_build_object(
    'tenants',(select count(*) from auth.users where email is not null),
    'chargers',(select count(*) from squid_properties),
    'active_sessions',(select count(*) from squid_sessions where status in ('starting','charging','stopping','settling')),
    'new_feedback',(select count(*) from squid_feedback where status='new')
  );
$$;

create or replace function public.squid_start_tenant_access(admin_id uuid,target_id uuid,access_token_hash text,access_reason text)
returns uuid language plpgsql security definer set search_path = public,pg_temp as $$
declare access_id uuid;
begin
  perform 1 from auth.users where id=admin_id and lower(email)='mingcan@ivoracharge.com' and email_confirmed_at is not null for update;
  if not found then raise insufficient_privilege using message='Administrator access required'; end if;
  if admin_id=target_id or not exists(select 1 from auth.users where id=target_id and email is not null) then
    raise no_data_found using message='Tenant not found';
  end if;
  with ended as (
    update squid_tenant_access set ended_at=now() where actor_id=admin_id and ended_at is null returning *
  )
  insert into squid_admin_audit(actor_id,tenant_id,access_id,event,reason)
    select actor_id,tenant_id,id,'access_ended','Switched workspace' from ended;
  insert into squid_tenant_access(actor_id,tenant_id,token_hash,reason)
    values(admin_id,target_id,access_token_hash,trim(access_reason)) returning id into access_id;
  insert into squid_admin_audit(actor_id,tenant_id,access_id,event,reason)
    values(admin_id,target_id,access_id,'access_started',trim(access_reason));
  return access_id;
end;
$$;

create or replace function public.squid_end_tenant_access(admin_id uuid,access_token_hash text)
returns void language plpgsql security definer set search_path = public,pg_temp as $$
begin
  with ended as (
    update squid_tenant_access set ended_at=now()
    where actor_id=admin_id and (access_token_hash is null or token_hash=access_token_hash) and ended_at is null returning *
  )
  insert into squid_admin_audit(actor_id,tenant_id,access_id,event,reason)
    select actor_id,tenant_id,id,'access_ended','Returned to admin' from ended;
end;
$$;

create or replace function public.squid_admin_feedback_status(admin_id uuid,feedback_id uuid,new_status text)
returns void language plpgsql security definer set search_path = public,pg_temp as $$
begin
  if not exists(select 1 from auth.users where id=admin_id and lower(email)='mingcan@ivoracharge.com' and email_confirmed_at is not null) then
    raise insufficient_privilege using message='Administrator access required';
  end if;
  update squid_feedback set status=new_status,updated_at=now() where id=feedback_id;
  if not found then raise no_data_found using message='Feedback not found'; end if;
  insert into squid_admin_audit(actor_id,subject_id,event,reason)
    values(admin_id,feedback_id,'feedback_updated',new_status);
end;
$$;

revoke all on function public.squid_admin_tenants(text,integer,integer),public.squid_admin_summary(),public.squid_start_tenant_access(uuid,uuid,text,text),public.squid_end_tenant_access(uuid,text),public.squid_admin_feedback_status(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.squid_admin_tenants(text,integer,integer),public.squid_admin_summary(),public.squid_start_tenant_access(uuid,uuid,text,text),public.squid_end_tenant_access(uuid,text),public.squid_admin_feedback_status(uuid,uuid,text) to service_role;

commit;
