-- Suspension is enforced below the UI, including SECURITY DEFINER writes.
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select private.account_is_active((select auth.uid())) and exists (
    select 1 from public.admins where admin_id=(select auth.uid())
  );
$$;
create or replace function private.is_verified_owner(p_owner_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $$
  select private.account_is_active(p_owner_id) and exists (
    select 1 from public.owners o join public.owner_verifications v on v.user_id=o.owner_id
    where o.owner_id=p_owner_id and o.status='active' and v.status='approved'
  );
$$;
create or replace function private.require_active_actor()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and not private.account_is_active(auth.uid()) then
    raise exception 'Your account access is suspended. Contact SNAP for help.' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.require_active_actor() from public,anon,authenticated;
do $$ declare item text; begin
  foreach item in array array['admins','owners','renters','dorms','rental_requests','rentals','owner_verifications','lgu_certification_requests','notifications','support_tickets','support_messages','rental_extensions'] loop
    execute format('create policy active_accounts_only on public.%I as restrictive for all to authenticated using ((select private.account_is_active())) with check ((select private.account_is_active()))',item);
    execute format('create trigger require_active_actor before insert or update or delete on public.%I for each row execute function private.require_active_actor()',item);
  end loop;
end $$;
create policy active_storage_accounts_only on storage.objects as restrictive for all to authenticated
using ((select private.account_is_active())) with check ((select private.account_is_active()));
revoke insert,update,delete on public.rental_extensions from public,anon,authenticated;

-- Validate private object references at the API boundary; never accept another user's path.
create or replace function private.validate_request_documents()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true) not in ('authenticated','anon') then return new; end if;
  if tg_op='INSERT' then
    if new.renter_gov_id_url is null or split_part(new.renter_gov_id_url,'/',1)<>auth.uid()::text
      or not exists(select 1 from storage.objects where bucket_id='private_documents' and name=new.renter_gov_id_url) then
      raise exception 'Upload your government ID before submitting this request';
    end if;
    if not exists(select 1 from public.dorms d where d.dorm_id=new.dorm_id and d.owner_id=new.owner_id
      and d.owner_id<>auth.uid() and d.status='active' and d.approval_status='approved'
      and d.available and d.occupied_tenants<d.max_tenants and private.is_verified_owner(d.owner_id)) then
      raise exception 'This dormitory is not accepting requests right now';
    end if;
  elsif new.status='payment_submitted' and new.payment_proof_url is distinct from old.payment_proof_url then
    if split_part(new.payment_proof_url,'/',1)<>auth.uid()::text or not exists(select 1 from storage.objects where bucket_id='private_documents' and name=new.payment_proof_url) then
      raise exception 'Upload your payment receipt before submitting proof';
    end if;
  elsif new.status='awaiting_payment' and new.status is distinct from old.status then
    if not exists(select 1 from storage.objects where bucket_id='private_documents' and name=new.owner_payment_qr_url)
      or not exists(select 1 from storage.objects where bucket_id='private_documents' and name=new.contract_url) then
      raise exception 'Upload the QR image and contract before accepting this request';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_request_documents() from public,anon,authenticated;
create trigger validate_request_documents before insert or update on public.rental_requests
for each row execute function private.validate_request_documents();

-- Admin identity review uses an ID already submitted with the renter's own request.
create table public.renter_verifications (
  user_id uuid primary key references public.renters(renter_id),
  request_id uuid not null references public.rental_requests(request_id),
  status text not null check(status in ('approved','rejected')),
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now()
);
alter table public.renter_verifications enable row level security;
revoke all on public.renter_verifications from public,anon,authenticated;
grant select on public.renter_verifications to authenticated;
create policy renter_verifications_read on public.renter_verifications for select to authenticated
using (((select auth.uid())=user_id or private.is_admin()) and (select private.account_is_active()));
create index renter_verifications_request_idx on public.renter_verifications(request_id);
create index renter_verifications_reviewer_idx on public.renter_verifications(reviewed_by);
create or replace function public.admin_review_renter_identity(p_request_id uuid,p_approved boolean)
returns void language plpgsql security definer set search_path='' as $$
declare r public.rental_requests%rowtype;
begin
  if not private.is_admin() then raise exception 'Administrator access required'; end if;
  select * into r from public.rental_requests where request_id=p_request_id;
  if r.request_id is null or r.user_id=auth.uid() then raise exception 'Another administrator must review this identity'; end if;
  if not exists(select 1 from storage.objects where bucket_id='private_documents' and name=r.renter_gov_id_url) then raise exception 'The protected ID is not available'; end if;
  insert into public.renter_verifications(user_id,request_id,status,reviewed_by)
  values(r.user_id,p_request_id,case when p_approved then 'approved' else 'rejected' end,auth.uid())
  on conflict(user_id) do update set request_id=excluded.request_id,status=excluded.status,reviewed_by=excluded.reviewed_by,reviewed_at=now();
  insert into public.system_logs(action,admin_id,actor_id,entity_type,entity_id,metadata)
    values('renter_identity_reviewed',auth.uid(),auth.uid(),'rental_request',p_request_id,jsonb_build_object('approved',p_approved));
end;
$$;
revoke all on function public.admin_review_renter_identity(uuid,boolean) from public,anon;
grant execute on function public.admin_review_renter_identity(uuid,boolean) to authenticated;

-- A project-wide server budget complements per-user limits. No client may reset it.
create table public.ai_project_quota (
  day date primary key,
  requests integer not null default 0,
  minute_start timestamptz not null default now(),
  minute_requests integer not null default 0
);
alter table public.ai_project_quota enable row level security;
revoke all on public.ai_project_quota from public,anon,authenticated;
create or replace function public.consume_ai_project_quota()
returns boolean language plpgsql security definer set search_path='' as $$
declare q public.ai_project_quota%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Server access required'; end if;
  insert into public.ai_project_quota(day) values(current_date) on conflict do nothing;
  select * into q from public.ai_project_quota where day=current_date for update;
  if q.minute_start<=now()-interval '1 minute' then q.minute_start:=now(); q.minute_requests:=0; end if;
  if q.requests>=150 or q.minute_requests>=5 then return false; end if;
  update public.ai_project_quota set requests=requests+1,minute_start=q.minute_start,minute_requests=q.minute_requests+1 where day=current_date;
  return true;
end;
$$;
revoke all on function public.consume_ai_project_quota() from public,anon,authenticated;
grant execute on function public.consume_ai_project_quota() to service_role;
notify pgrst,'reload schema';
