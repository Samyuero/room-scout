-- Additive admin/support workflow; old tickets are preserved.
create table if not exists public.account_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','suspended')),
  reason text check (char_length(reason) <= 1000),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.account_access enable row level security;
create or replace function private.account_is_active(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $$
  select p_user_id is not null and not exists (
    select 1 from public.account_access a where a.user_id=p_user_id and a.status='suspended'
  );
$$;
revoke all on function private.account_is_active(uuid) from public, anon;
grant execute on function private.account_is_active(uuid) to authenticated;
grant select on public.account_access to authenticated;
revoke insert, update, delete on public.account_access from anon, authenticated;
drop policy if exists account_access_read on public.account_access;
create policy account_access_read on public.account_access for select to authenticated
using (user_id=(select auth.uid()) or private.is_admin());

alter table public.notifications add column if not exists related_ticket_id uuid references public.support_tickets(ticket_id);
alter table public.notifications add column if not exists related_verification_id uuid references public.owner_verifications(verification_id);
alter table public.notifications add column if not exists related_certification_id uuid references public.lgu_certification_requests(certification_id);
alter table public.support_tickets add column if not exists related_request_id uuid references public.rental_requests(request_id);
revoke insert,update,delete on public.support_tickets from anon,authenticated;
create index if not exists support_tickets_user_updated_idx on public.support_tickets(user_id,updated_at desc);
create index if not exists support_tickets_admin_status_idx on public.support_tickets(admin_id,status,updated_at desc);
create index if not exists notifications_related_ticket_idx on public.notifications(related_ticket_id) where related_ticket_id is not null;

create table if not exists public.support_messages (
  message_id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(ticket_id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists support_messages_ticket_created_idx on public.support_messages(ticket_id,created_at,message_id);
create index if not exists support_messages_sender_idx on public.support_messages(sender_id);
alter table public.support_messages enable row level security;
grant select on public.support_messages to authenticated;
revoke insert,update,delete on public.support_messages from anon, authenticated;
drop policy if exists support_messages_participants on public.support_messages;
create policy support_messages_participants on public.support_messages for select to authenticated
using (private.is_admin() or (not internal and exists (
  select 1 from public.support_tickets t where t.ticket_id=support_messages.ticket_id and t.user_id=(select auth.uid())
)));
drop policy if exists support_messages_active_accounts on public.support_messages;
create policy support_messages_active_accounts on public.support_messages as restrictive for all to authenticated
using ((select private.account_is_active())) with check ((select private.account_is_active()));

create or replace function public.create_support_ticket(p_subject text,p_description text,p_related_request_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); id uuid;
begin
  if actor is null or not private.account_is_active(actor) then raise exception 'An active signed-in account is required'; end if;
  if char_length(btrim(coalesce(p_subject,''))) not between 3 and 120 or char_length(btrim(coalesce(p_description,''))) not between 5 and 4000 then
    raise exception 'Enter a subject (3–120 characters) and description (5–4000 characters)';
  end if;
  if p_related_request_id is not null and not exists (select 1 from public.rental_requests r where r.request_id=p_related_request_id and (r.user_id=actor or r.owner_id=actor or private.is_admin())) then
    raise exception 'You cannot report a transaction that is not yours';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':support',0));
  if (select count(*) from public.support_tickets where user_id=actor and created_at>now()-interval '1 hour')>=5 then raise exception 'Please wait before creating more reports. You can reply to an existing ticket.'; end if;
  insert into public.support_tickets(user_id,subject,description,related_request_id)
    values(actor,btrim(p_subject),btrim(p_description),p_related_request_id) returning ticket_id into id;
  return id;
end;
$$;

create or replace function public.send_support_message(p_ticket_id uuid,p_body text,p_internal boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item public.support_tickets%rowtype; id uuid; admin_actor boolean:=private.is_admin();
begin
  if actor is null or not private.account_is_active(actor) then raise exception 'An active signed-in account is required'; end if;
  select * into item from public.support_tickets where ticket_id=p_ticket_id for update;
  if item.ticket_id is null or (item.user_id<>actor and not admin_actor) then raise exception 'Ticket not found or access denied'; end if;
  if p_internal and not admin_actor then raise exception 'Only administrators can add internal notes'; end if;
  if item.status='closed' and not admin_actor then raise exception 'This ticket is closed. Create a new report if you need more help.'; end if;
  if char_length(btrim(coalesce(p_body,''))) not between 1 and 4000 then raise exception 'Message must be 1–4000 characters'; end if;
  if (select count(*) from public.support_messages where sender_id=actor and created_at>now()-interval '1 minute')>=10 then raise exception 'Please wait a moment before sending more messages'; end if;
  insert into public.support_messages(ticket_id,sender_id,body,internal) values(p_ticket_id,actor,btrim(p_body),p_internal) returning message_id into id;
  update public.support_tickets set updated_at=now(),status=case when not admin_actor and status='resolved' then 'open' else status end where ticket_id=p_ticket_id;
  if not p_internal then
    if admin_actor then
      insert into public.notifications(user_id,title,message,type,related_ticket_id) values(item.user_id,'SNAP replied to your report',item.subject,'support_reply',p_ticket_id);
    else
      insert into public.notifications(user_id,title,message,type,related_ticket_id)
        select a.admin_id,'New support reply',item.subject,'admin_support_reply',p_ticket_id from public.admins a
        where (item.admin_id is null or a.admin_id=item.admin_id) and private.account_is_active(a.admin_id);
    end if;
  end if;
  return id;
end;
$$;

create or replace function public.admin_update_support_ticket(p_ticket_id uuid,p_status text,p_assigned_admin uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare item public.support_tickets%rowtype;
begin
  if not private.is_admin() or not private.account_is_active() then raise exception 'Administrator access required'; end if;
  if p_status not in ('open','in_progress','resolved','closed') then raise exception 'Invalid ticket status'; end if;
  if p_assigned_admin is not null and not exists(select 1 from public.admins where admin_id=p_assigned_admin and private.account_is_active(admin_id)) then raise exception 'Choose an active administrator'; end if;
  select * into item from public.support_tickets where ticket_id=p_ticket_id for update;
  if item.ticket_id is null then raise exception 'Ticket not found'; end if;
  update public.support_tickets set status=p_status,admin_id=p_assigned_admin,updated_at=now() where ticket_id=p_ticket_id;
  if item.status is distinct from p_status then
    insert into public.notifications(user_id,title,message,type,related_ticket_id)
      values(item.user_id,'Report status updated',item.subject || ': ' || replace(p_status,'_',' '),'support_status',p_ticket_id);
  end if;
  insert into public.system_logs(action,admin_id,actor_id,entity_type,entity_id,metadata)
    values('support_ticket_updated',auth.uid(),auth.uid(),'support_ticket',p_ticket_id,jsonb_build_object('status',p_status,'assigned_admin',p_assigned_admin));
end;
$$;

create or replace function private.notify_support_ticket_created()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(user_id,title,message,type,related_ticket_id)
    select admin_id,'New support report',new.subject,'admin_support_created',new.ticket_id from public.admins where private.account_is_active(admin_id);
  return new;
end;
$$;
drop trigger if exists roomscout_support_created on public.support_tickets;
create trigger roomscout_support_created after insert on public.support_tickets for each row execute function private.notify_support_ticket_created();

-- Applicant writes are RPC-only: INSERT status='approved' can never self-verify.
revoke insert,update,delete on public.owner_verifications from anon, authenticated;
create or replace function public.submit_owner_verification(p_document_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item public.owner_verifications%rowtype; id uuid;
begin
  if actor is null or not private.account_is_active(actor) then raise exception 'An active signed-in account is required'; end if;
  if not exists(select 1 from public.owners where owner_id=actor) then raise exception 'Register as a dorm owner before requesting verification'; end if;
  if p_document_path not like actor::text || '/verifications/%' or p_document_path like '%..%' or not exists(select 1 from storage.objects where bucket_id='private_documents' and name=p_document_path) then raise exception 'Upload your verification image to secure storage first'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':owner-verification',0));
  select * into item from public.owner_verifications where user_id=actor for update;
  if item.status='approved' then raise exception 'Your owner account is already verified'; end if;
  if item.status='pending' then raise exception 'Your verification is already awaiting review'; end if;
  if item.verification_id is null then
    insert into public.owner_verifications(user_id,document_url,status) values(actor,p_document_path,'pending') returning verification_id into id;
  else
    update public.owner_verifications set document_url=p_document_path,status='pending',reviewed_by=null,admin_notes=null,created_at=now(),updated_at=now() where verification_id=item.verification_id returning verification_id into id;
  end if;
  insert into public.notifications(user_id,title,message,type,related_verification_id)
    select admin_id,'Owner verification needs review','A dorm owner submitted verification.','admin_owner_verification',id from public.admins where private.account_is_active(admin_id);
  return id;
end;
$$;
create or replace function public.review_owner_verification(p_verification_id uuid,p_approved boolean,p_notes text default null)
returns void language plpgsql security definer set search_path='' as $$
declare item public.owner_verifications%rowtype;
begin
  if not private.is_admin() or not private.account_is_active() then raise exception 'Administrator access required'; end if;
  select * into item from public.owner_verifications where verification_id=p_verification_id for update;
  if item.verification_id is null or item.status<>'pending' then raise exception 'Pending verification not found'; end if;
  if item.user_id=auth.uid() then raise exception 'Another administrator must review your own verification'; end if;
  if char_length(coalesce(p_notes,''))>1000 then raise exception 'Review note is too long'; end if;
  if p_approved and not exists(select 1 from storage.objects where bucket_id='private_documents' and name=item.document_url) then raise exception 'The protected document is unavailable. Ask the owner to submit it again.'; end if;
  update public.owner_verifications set status=case when p_approved then 'approved' else 'rejected' end,reviewed_by=auth.uid(),admin_notes=nullif(btrim(p_notes),''),updated_at=now() where verification_id=p_verification_id;
  insert into public.notifications(user_id,title,message,type,related_verification_id)
    values(item.user_id,'Owner verification updated',case when p_approved then 'Your dorm owner verification was approved.' else 'Your verification needs a corrected document. Open the verification form to review and resubmit.' end,'owner_verification',p_verification_id);
  insert into public.system_logs(action,admin_id,actor_id,entity_type,entity_id,metadata)
    values('owner_verification_reviewed',auth.uid(),auth.uid(),'owner_verification',p_verification_id,jsonb_build_object('approved',p_approved));
end;
$$;

create or replace function public.admin_set_listing_flags(p_dorm_id uuid,p_featured boolean default null,p_lgu_certified boolean default null,p_active boolean default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() or not private.account_is_active() then raise exception 'Administrator access required'; end if;
  perform 1 from public.dorms where dorm_id=p_dorm_id for update;
  if not found then raise exception 'Listing not found'; end if;
  if p_lgu_certified=true and not exists(select 1 from public.lgu_certification_requests where dorm_id=p_dorm_id and status='approved') then raise exception 'Review and approve the owner’s LGU proof before granting a badge'; end if;
  update public.dorms set is_featured=coalesce(p_featured,is_featured),lgu_certified=coalesce(p_lgu_certified,lgu_certified),status=case when p_active is null then status when p_active then 'active' else 'inactive' end,updated_at=now() where dorm_id=p_dorm_id;
  insert into public.system_logs(action,admin_id,actor_id,entity_type,entity_id,metadata)
    values('listing_moderated',auth.uid(),auth.uid(),'dorm',p_dorm_id,jsonb_strip_nulls(jsonb_build_object('featured',p_featured,'lgu_certified',p_lgu_certified,'active',p_active)));
end;
$$;

create or replace function public.admin_list_accounts()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_admin() or not private.account_is_active() then raise exception 'Administrator access required'; end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc),'[]'::jsonb) into result from (
    select u.id user_id,u.email,u.created_at,coalesce(a.full_name,o.full_name,r.full_name,'Account holder') full_name,coalesce(a.username,o.username,r.username) username,
      (a.admin_id is not null) is_admin,(o.owner_id is not null) is_owner,(v.status='approved') owner_verified,
      coalesce(x.status,'active') access_status,x.reason access_reason
    from auth.users u left join public.admins a on a.admin_id=u.id left join public.owners o on o.owner_id=u.id
      left join public.renters r on r.renter_id=u.id left join public.owner_verifications v on v.user_id=u.id left join public.account_access x on x.user_id=u.id
  ) t;
  return result;
end;
$$;
create or replace function public.admin_set_account_access(p_user_id uuid,p_status text,p_reason text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() or not private.account_is_active() then raise exception 'Administrator access required'; end if;
  if p_user_id=auth.uid() then raise exception 'You cannot suspend your own administrator account'; end if;
  if p_status not in ('active','suspended') or char_length(coalesce(p_reason,''))>1000 then raise exception 'Invalid account status or reason'; end if;
  if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Account not found'; end if;
  insert into public.account_access(user_id,status,reason,updated_by,updated_at) values(p_user_id,p_status,nullif(btrim(p_reason),''),auth.uid(),now())
    on conflict(user_id) do update set status=excluded.status,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  insert into public.system_logs(action,admin_id,actor_id,entity_type,entity_id,metadata)
    values('account_access_changed',auth.uid(),auth.uid(),'account',p_user_id,jsonb_build_object('status',p_status));
end;
$$;
create or replace function public.admin_revoke_privilege(p_user_id uuid,p_privilege text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() or not private.account_is_active() then raise exception 'Administrator access required'; end if;
  if p_user_id=auth.uid() then raise exception 'Another administrator must review your own privileges'; end if;
  if p_privilege='admin' then
    lock table public.admins in share row exclusive mode;
    if (select count(*) from public.admins)<=1 then raise exception 'The last administrator cannot be removed'; end if;
    update public.support_tickets set admin_id=null where admin_id=p_user_id;
    delete from public.admins where admin_id=p_user_id;
  elsif p_privilege='owner_verification' then
    update public.owner_verifications set status='rejected',reviewed_by=auth.uid(),admin_notes='Verification revoked by an administrator. Submit an updated document.',updated_at=now() where user_id=p_user_id;
  else raise exception 'Unknown privilege'; end if;
  insert into public.system_logs(action,admin_id,actor_id,entity_type,entity_id,metadata)
    values('account_privilege_revoked',auth.uid(),auth.uid(),'account',p_user_id,jsonb_build_object('privilege',p_privilege));
end;
$$;

-- All mutations above authenticate inside the function; no key with elevated privileges is sent to the APK.
do $$ declare signature text; begin
  foreach signature in array array[
    'create_support_ticket(text,text,uuid)','send_support_message(uuid,text,boolean)','admin_update_support_ticket(uuid,text,uuid)',
    'submit_owner_verification(text)','review_owner_verification(uuid,boolean,text)','admin_set_listing_flags(uuid,boolean,boolean,boolean)',
    'admin_list_accounts()','admin_set_account_access(uuid,text,text)','admin_revoke_privilege(uuid,text)'
  ] loop
    execute 'revoke all on function public.' || signature || ' from public,anon';
    execute 'grant execute on function public.' || signature || ' to authenticated';
  end loop;
end $$;
revoke all on function private.notify_support_ticket_created() from public,anon,authenticated;
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_messages') then alter publication supabase_realtime add table public.support_messages; end if;
end $$;
notify pgrst,'reload schema';
