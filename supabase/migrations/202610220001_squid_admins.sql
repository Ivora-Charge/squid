begin;

-- Administrators are rows in squid_admins instead of an address in the code.
-- This migration seeds nothing: after applying it, add your own admins with
-- scripts/set-admins.mjs (reads ADMIN_EMAILS) or a one-line insert:
--   insert into public.squid_admins(email) values ('you@example.com');
-- Until then nobody has admin access.
create table if not exists public.squid_admins (
  email text primary key check (email = lower(email) and email = btrim(email) and email like '%_@_%'),
  created_at timestamptz not null default now()
);
alter table public.squid_admins enable row level security;
revoke all on public.squid_admins from public,anon,authenticated,service_role;
grant select,insert,delete on public.squid_admins to service_role;

-- The admin functions authorize a verified user whose email is listed above.
create or replace function public.squid_start_tenant_access(admin_id uuid,target_id uuid,access_token_hash text,access_reason text)
returns uuid language plpgsql security definer set search_path = public,pg_temp as $$
declare access_id uuid;
begin
  perform 1 from auth.users u where u.id=admin_id and u.email_confirmed_at is not null and exists(select 1 from public.squid_admins a where a.email = lower(u.email)) for update of u;
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

create or replace function public.squid_admin_feedback_status(admin_id uuid,feedback_id uuid,new_status text)
returns void language plpgsql security definer set search_path = public,pg_temp as $$
begin
  if not exists(select 1 from public.squid_admins a join auth.users u on lower(u.email) = a.email where u.id = admin_id and u.email_confirmed_at is not null) then
    raise insufficient_privilege using message='Administrator access required';
  end if;
  update squid_feedback set status=new_status,updated_at=now() where id=feedback_id;
  if not found then raise no_data_found using message='Feedback not found'; end if;
  insert into squid_admin_audit(actor_id,subject_id,event,reason)
    values(admin_id,feedback_id,'feedback_updated',new_status);
end;
$$;

create or replace function public.squid_newsletter_approve(admin_id uuid,target_id uuid,content_hash text)
returns void language plpgsql security definer set search_path = public,pg_temp as $$
begin
  if not exists(select 1 from public.squid_admins a join auth.users u on lower(u.email) = a.email where u.id = admin_id and u.email_confirmed_at is not null) then
    raise insufficient_privilege using message='Administrator access required';
  end if;
  update squid_newsletter_issues set status='approved',approved_by=admin_id,approved_at=now(),approved_hash=content_hash
    where id=target_id and status='draft' and tested_hash=content_hash
      and squid_newsletter_content_hash(title,body)=content_hash;
  if not found then raise check_violation using message='Send a test of this exact draft before approving it'; end if;
end;
$$;

create or replace function public.squid_newsletter_start_send(admin_id uuid,target_id uuid)
returns integer language plpgsql security definer set search_path = public,pg_temp as $$
declare recipients integer;
begin
  if not exists(select 1 from public.squid_admins a join auth.users u on lower(u.email) = a.email where u.id = admin_id and u.email_confirmed_at is not null) then
    raise insufficient_privilege using message='Administrator access required';
  end if;
  update squid_newsletter_issues set status='sending',send_started_at=now()
    where id=target_id and status='approved' and approved_hash=squid_newsletter_content_hash(title,body);
  if not found then raise check_violation using message='Only an approved issue can be sent'; end if;
  insert into squid_newsletter_deliveries(issue_id,host_id,email)
    select target_id,u.id,lower(u.email) from squid_newsletter_consent c join auth.users u on u.id=c.host_id
    where c.subscribed and u.email is not null and u.email_confirmed_at is not null
      and not exists(select 1 from squid_newsletter_suppressions s where s.email=lower(u.email))
    on conflict (issue_id,email) do nothing;
  get diagnostics recipients = row_count;
  return recipients;
end;
$$;

revoke all on function public.squid_start_tenant_access(uuid,uuid,text,text),public.squid_admin_feedback_status(uuid,uuid,text),public.squid_newsletter_approve(uuid,uuid,text),public.squid_newsletter_start_send(uuid,uuid) from public,anon,authenticated;
grant execute on function public.squid_start_tenant_access(uuid,uuid,text,text),public.squid_admin_feedback_status(uuid,uuid,text),public.squid_newsletter_approve(uuid,uuid,text),public.squid_newsletter_start_send(uuid,uuid) to service_role;

commit;
