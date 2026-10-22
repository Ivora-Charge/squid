begin;

-- Host newsletter. Consent defaults to off: a host is only subscribed after an
-- explicit opt-in, and every change is kept as a timestamped consent event.
create table if not exists public.squid_newsletter_consent (
  host_id uuid primary key references auth.users(id) on delete cascade,
  subscribed boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.squid_newsletter_consent_events (
  id uuid primary key default gen_random_uuid(),
  host_id uuid references auth.users(id) on delete set null,
  email text not null check (char_length(email) between 3 and 254),
  action text not null check (action in ('opt_in','opt_out')),
  source text not null check (source in ('settings','unsubscribe')),
  wording text not null check (char_length(wording) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists squid_newsletter_consent_events_host on public.squid_newsletter_consent_events(host_id,created_at desc);

-- Addresses that must never receive the newsletter, whatever their consent.
create table if not exists public.squid_newsletter_suppressions (
  email text primary key check (email = lower(email) and char_length(email) between 3 and 254),
  reason text not null check (reason in ('unsubscribed','bounced','complained')),
  issue_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.squid_newsletter_issues (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 3 and 120),
  body text not null check (char_length(trim(body)) between 3 and 20000),
  status text not null default 'draft' check (status in ('draft','approved','sending','sent')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  test_sent_at timestamptz,
  tested_hash text check (tested_hash ~ '^[a-f0-9]{64}$'),
  approved_by uuid,
  approved_at timestamptz,
  approved_hash text check (approved_hash ~ '^[a-f0-9]{64}$'),
  send_started_at timestamptz,
  sent_at timestamptz,
  -- Nothing leaves draft without a recorded administrator approval.
  check (status = 'draft' or (approved_by is not null and approved_at is not null and approved_hash is not null))
);
create index if not exists squid_newsletter_issues_status on public.squid_newsletter_issues(status,created_at desc);

create table if not exists public.squid_newsletter_deliveries (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.squid_newsletter_issues(id) on delete cascade,
  host_id uuid references auth.users(id) on delete set null,
  email text not null check (char_length(email) between 3 and 254),
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped','bounced')),
  provider_id text check (char_length(provider_id) <= 200),
  sent_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (issue_id,email)
);
create index if not exists squid_newsletter_deliveries_issue on public.squid_newsletter_deliveries(issue_id,status);
create index if not exists squid_newsletter_deliveries_provider on public.squid_newsletter_deliveries(provider_id) where provider_id is not null;

create table if not exists public.squid_newsletter_clicks (
  id bigint generated always as identity primary key,
  issue_id uuid not null references public.squid_newsletter_issues(id) on delete cascade,
  delivery_id uuid references public.squid_newsletter_deliveries(id) on delete cascade,
  url text not null check (char_length(url) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists squid_newsletter_clicks_issue on public.squid_newsletter_clicks(issue_id);

alter table public.squid_newsletter_consent enable row level security;
alter table public.squid_newsletter_consent_events enable row level security;
alter table public.squid_newsletter_suppressions enable row level security;
alter table public.squid_newsletter_issues enable row level security;
alter table public.squid_newsletter_deliveries enable row level security;
alter table public.squid_newsletter_clicks enable row level security;
revoke all on public.squid_newsletter_consent,public.squid_newsletter_consent_events,public.squid_newsletter_suppressions,public.squid_newsletter_issues,public.squid_newsletter_deliveries,public.squid_newsletter_clicks from public,anon,authenticated,service_role;
grant select on public.squid_newsletter_consent,public.squid_newsletter_consent_events,public.squid_newsletter_suppressions to service_role;
grant select,insert,update on public.squid_newsletter_issues,public.squid_newsletter_deliveries to service_role;
grant select,insert on public.squid_newsletter_clicks to service_role;

-- Consent changes go through this function so the event log cannot be skipped.
create or replace function public.squid_newsletter_set_consent(target_host uuid,now_subscribed boolean,consent_wording text)
returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare address text; changed boolean;
begin
  select lower(email) into address from auth.users where id=target_host and email is not null;
  if not found then raise no_data_found using message='Host not found'; end if;
  insert into squid_newsletter_consent(host_id,subscribed,updated_at) values(target_host,now_subscribed,now())
    on conflict (host_id) do update set subscribed=excluded.subscribed,updated_at=now()
    where squid_newsletter_consent.subscribed is distinct from excluded.subscribed;
  changed := found;
  if changed then
    insert into squid_newsletter_consent_events(host_id,email,action,source,wording)
      values(target_host,address,case when now_subscribed then 'opt_in' else 'opt_out' end,'settings',consent_wording);
  end if;
  -- A fresh, signed-in opt-in lifts an earlier unsubscribe. Bounces and
  -- complaints stay suppressed.
  if now_subscribed then
    delete from squid_newsletter_suppressions where email=address and reason='unsubscribed';
  end if;
  return (select jsonb_build_object('subscribed',subscribed,'updated_at',updated_at) from squid_newsletter_consent where host_id=target_host);
end;
$$;

create or replace function public.squid_newsletter_unsubscribe(target_delivery uuid)
returns boolean language plpgsql security definer set search_path = public,pg_temp as $$
declare d squid_newsletter_deliveries;
begin
  select * into d from squid_newsletter_deliveries where id=target_delivery;
  if not found then return false; end if;
  insert into squid_newsletter_suppressions(email,reason,issue_id) values(d.email,'unsubscribed',d.issue_id)
    on conflict (email) do nothing;
  update squid_newsletter_deliveries set unsubscribed_at=coalesce(unsubscribed_at,now()) where id=target_delivery;
  if d.host_id is not null then
    update squid_newsletter_consent set subscribed=false,updated_at=now() where host_id=d.host_id and subscribed;
    if found then
      insert into squid_newsletter_consent_events(host_id,email,action,source,wording)
        values(d.host_id,d.email,'opt_out','unsubscribe','One-click unsubscribe from a Squid host newsletter email');
    end if;
  end if;
  return true;
end;
$$;

create or replace function public.squid_newsletter_bounce(provider text,addresses text[],kind text)
returns void language plpgsql security definer set search_path = public,pg_temp as $$
begin
  if kind not in ('bounced','complained') then raise invalid_parameter_value using message='Unknown suppression reason'; end if;
  update squid_newsletter_deliveries set status='bounced' where provider_id=provider and kind='bounced';
  insert into squid_newsletter_suppressions(email,reason,issue_id)
    select distinct lower(trim(a)),kind,(select issue_id from squid_newsletter_deliveries where provider_id=provider limit 1)
    from unnest(addresses) a where char_length(trim(a)) between 3 and 254
    on conflict (email) do nothing;
end;
$$;

create or replace function public.squid_newsletter_content_hash(issue_title text,issue_body text)
returns text language sql immutable set search_path = public,pg_temp as $$
  select encode(sha256(convert_to(issue_title || chr(10) || issue_body,'UTF8')),'hex');
$$;

-- Approval requires the verified administrator, a test of the current content,
-- and the exact content hash the administrator previewed.
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

-- Starting a send snapshots the recipients: confirmed hosts who opted in and
-- are not suppressed. Only an approved issue with unchanged content can start.
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

-- Re-checks consent and suppression immediately before each batch, so an
-- unsubscribe during a send is honored.
create or replace function public.squid_newsletter_pending(target_id uuid,batch_size integer default 40)
returns setof public.squid_newsletter_deliveries language plpgsql security definer set search_path = public,pg_temp as $$
begin
  update squid_newsletter_deliveries d set status='skipped'
    where d.issue_id=target_id and d.status='pending' and (
      exists(select 1 from squid_newsletter_suppressions s where s.email=d.email)
      or not exists(select 1 from squid_newsletter_consent c where c.host_id=d.host_id and c.subscribed)
    );
  return query select d.* from squid_newsletter_deliveries d
    join squid_newsletter_issues i on i.id=d.issue_id and i.status='sending'
    where d.issue_id=target_id and d.status='pending'
    order by d.created_at,d.id limit least(greatest(batch_size,1),100);
end;
$$;

create or replace function public.squid_newsletter_overview()
returns jsonb language sql stable security definer set search_path = public,pg_temp as $$
  select jsonb_build_object(
    'audience',(select count(*) from squid_newsletter_consent c join auth.users u on u.id=c.host_id
      where c.subscribed and u.email is not null and u.email_confirmed_at is not null
      and not exists(select 1 from squid_newsletter_suppressions s where s.email=lower(u.email))),
    'issues',coalesce((select jsonb_agg(r order by r.created_at desc,r.id) from (
      select i.id,i.title,i.body,i.status,i.created_at,i.updated_at,i.test_sent_at,i.approved_at,i.send_started_at,i.sent_at,
        (select count(*) from squid_newsletter_deliveries d where d.issue_id=i.id) as recipients,
        (select count(*) from squid_newsletter_deliveries d where d.issue_id=i.id and d.status in ('sent','bounced')) as sent,
        (select count(*) from squid_newsletter_deliveries d where d.issue_id=i.id and d.status='bounced') as bounced,
        (select count(*) from squid_newsletter_deliveries d where d.issue_id=i.id and d.unsubscribed_at is not null) as unsubscribed,
        (select count(*) from squid_newsletter_clicks k where k.issue_id=i.id) as clicks
      from squid_newsletter_issues i order by i.created_at desc limit 50
    ) r),'[]'::jsonb)
  );
$$;

revoke all on function public.squid_newsletter_set_consent(uuid,boolean,text),public.squid_newsletter_unsubscribe(uuid),public.squid_newsletter_bounce(text,text[],text),public.squid_newsletter_content_hash(text,text),public.squid_newsletter_approve(uuid,uuid,text),public.squid_newsletter_start_send(uuid,uuid),public.squid_newsletter_pending(uuid,integer),public.squid_newsletter_overview() from public,anon,authenticated;
grant execute on function public.squid_newsletter_set_consent(uuid,boolean,text),public.squid_newsletter_unsubscribe(uuid),public.squid_newsletter_bounce(text,text[],text),public.squid_newsletter_content_hash(text,text),public.squid_newsletter_approve(uuid,uuid,text),public.squid_newsletter_start_send(uuid,uuid),public.squid_newsletter_pending(uuid,integer),public.squid_newsletter_overview() to service_role;

commit;
