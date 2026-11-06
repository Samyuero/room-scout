-- Rental and refund workflow. Apply after admin_support_completion.
-- Money is transferred by the participants, not by RoomScout. This records the
-- 90% refund / 10% deduction, evidence and recipient confirmation atomically.
alter table public.rental_requests
  add column if not exists slot_allocated boolean not null default false,
  add column if not exists refund_amount numeric(12,2),
  add column if not exists refund_deduction numeric(12,2),
  add column if not exists refund_requested_at timestamptz,
  add column if not exists refund_confirmed_at timestamptz,
  add column if not exists converted_at timestamptz;
alter table public.rental_requests drop constraint if exists rental_requests_status_check;
alter table public.rental_requests add constraint rental_requests_status_check check
  (status in ('pending','rejected','awaiting_payment','awaiting_cash','payment_submitted','approved','reserved','cancelled','refund_requested','refund_sent','refund_completed','completed'));
alter table public.rentals
  add column if not exists request_id uuid references public.rental_requests(request_id) on delete set null,
  add column if not exists planned_end_date timestamptz;
create unique index if not exists rentals_request_id_unique on public.rentals(request_id) where request_id is not null;
create index if not exists rentals_dorm_status_start on public.rentals(dorm_id,status,start_date desc);
create index if not exists requests_renter_history on public.rental_requests(user_id,created_at desc);

-- Direct table edits are limited to accepting/declining and submitting receipts.
-- All capacity, payment and refund transitions must run the authorized RPCs.
create or replace function private.enforce_request_transition() returns trigger
language plpgsql set search_path='' as $$
declare actor uuid := (select auth.uid()); direct_client boolean := current_user in ('authenticated','anon');
begin
  if tg_op='INSERT' then
    if new.status<>'pending' or new.payment_status<>'unpaid' or new.slot_allocated
      or new.payment_verified_by is not null or new.payment_verified_at is not null
      or new.payment_proof_url is not null or coalesce(new.contract_agreed,false)
      or new.refund_amount is not null or new.refund_requested_at is not null or new.refund_deduction is not null
      or new.refund_confirmed_at is not null or new.refund_sent_at is not null or new.converted_at is not null
      or new.required_amount is not null or new.owner_payment_qr_url is not null or new.contract_url is not null
      or new.renter_refund_qr_url is not null or new.refund_proof_url is not null
      or new.renter_gcash_name is not null or new.renter_gcash_number is not null then
      raise exception 'New requests must start unpaid and pending';
    end if;
    return new;
  end if;
  if new.request_id is distinct from old.request_id or new.dorm_id is distinct from old.dorm_id
    or new.user_id is distinct from old.user_id or new.owner_id is distinct from old.owner_id
    or new.request_type is distinct from old.request_type or new.created_at is distinct from old.created_at
    or new.payment_method is distinct from old.payment_method then
    raise exception 'Request participants and type cannot be changed';
  end if;
  if not direct_client then return new; end if;
  if not private.account_is_active(actor) then raise exception 'Account access is suspended'; end if;
  if actor=old.user_id and old.status='awaiting_payment' and old.payment_method='qr'
    and new.status='payment_submitted' and new.payment_status='pending_verification'
    and new.contract_agreed and coalesce(trim(new.payment_proof_url),'')<>''
    and split_part(new.payment_proof_url,'/',1)=actor::text
    and (to_jsonb(new)-array['status','payment_status','contract_agreed','payment_proof_url','updated_at'])
       =(to_jsonb(old)-array['status','payment_status','contract_agreed','payment_proof_url','updated_at']) then return new; end if;
  if actor=old.owner_id and old.status='pending' then
    if new.status='rejected' and (to_jsonb(new)-array['status','updated_at'])=(to_jsonb(old)-array['status','updated_at']) then return new; end if;
    if old.payment_method='qr' and new.status='awaiting_payment' and new.required_amount>0 and new.required_amount<1000000000
      and split_part(new.owner_payment_qr_url,'/',1)=actor::text and split_part(new.contract_url,'/',1)=actor::text
      and (to_jsonb(new)-array['status','required_amount','owner_payment_qr_url','contract_url','updated_at'])
         =(to_jsonb(old)-array['status','required_amount','owner_payment_qr_url','contract_url','updated_at']) then return new; end if;
  end if;
  raise exception 'This change requires an authorized workflow action';
end $$;

-- Link legacy active tenancies only where the originating request is unambiguous.
update public.rentals t set request_id=q.request_id from (
  select t.rental_id,min(r.request_id::text)::uuid request_id
  from public.rentals t join public.rental_requests r on r.dorm_id=t.dorm_id and r.user_id=t.user_id
  where t.status='active' and t.request_id is null and r.status='approved' and r.payment_status='paid'
  group by t.rental_id having count(*)=1
) q where t.rental_id=q.rental_id;
update public.rental_requests r set slot_allocated=true
where r.status in ('reserved','refund_requested','refund_sent')
  or exists(select 1 from public.rentals t where t.request_id=r.request_id and t.status='active');
drop index if exists public.rental_requests_one_open_per_renter_dorm;
create unique index rental_requests_one_open_per_renter_dorm on public.rental_requests(user_id,dorm_id)
where status in ('pending','awaiting_payment','awaiting_cash','payment_submitted','approved','reserved','refund_requested','refund_sent');

create or replace function private.complete_owner_payment(p_request_id uuid,p_method text,p_approved boolean) returns void
language plpgsql security definer set search_path='' as $$
declare r public.rental_requests%rowtype; d public.dorms%rowtype; actor uuid := (select auth.uid());
begin
  if not private.account_is_active(actor) then raise exception 'Account access is suspended'; end if;
  select * into r from public.rental_requests where request_id=p_request_id and owner_id=actor and payment_method=p_method for update;
  if r.request_id is null then raise exception 'Request not found or access denied'; end if;
  if (p_method='cash' and r.status<>'awaiting_cash') or
     (p_method='qr' and not (r.status='payment_submitted' or (r.status='cancelled' and r.payment_status='pending_verification'))) then
    raise exception 'Refresh this request before confirming payment';
  end if;
  if p_method='qr' and coalesce(r.payment_proof_url,'')='' then raise exception 'Payment proof is required'; end if;
  if not p_approved then
    if p_method<>'qr' then raise exception 'Only QR receipts can be rejected'; end if;
    update public.rental_requests set status=case when status='cancelled' then 'cancelled' else 'awaiting_payment' end,
      payment_status='rejected',payment_proof_url=null,contract_agreed=false,updated_at=now() where request_id=r.request_id;
    return;
  end if;
  -- A cancelled receipt remains cancelled; reviewing it must not allocate a bed.
  if r.status='cancelled' then
    update public.rental_requests set payment_status='paid',payment_verified_by=actor,payment_verified_at=now(),updated_at=now() where request_id=r.request_id;
    return;
  end if;
  select * into d from public.dorms where dorm_id=r.dorm_id and owner_id=actor for update;
  if d.dorm_id is null or not d.available or d.occupied_tenants>=d.max_tenants then raise exception 'No tenant slots are available'; end if;
  update public.rental_requests set status=case when request_type='reservation' then 'reserved' else 'approved' end,
    payment_status='paid',payment_verified_by=actor,payment_verified_at=now(),slot_allocated=true,updated_at=now() where request_id=r.request_id;
  update public.dorms set occupied_tenants=occupied_tenants+1,available=occupied_tenants+1<max_tenants,
    availability_status=case when occupied_tenants+1<max_tenants then 'available' when r.request_type='reservation' then 'reserved' else 'unavailable' end,
    updated_at=now() where dorm_id=r.dorm_id;
  if r.request_type='rental' then
    insert into public.rentals(dorm_id,user_id,request_id,status,start_date) values(r.dorm_id,r.user_id,r.request_id,'active',now());
  end if;
end $$;
revoke all on function private.complete_owner_payment(uuid,text,boolean) from public,anon,authenticated;
create or replace function public.owner_confirm_qr_payment(p_request_id uuid,p_approved boolean) returns void
language plpgsql security definer set search_path='' as $$ begin perform private.complete_owner_payment(p_request_id,'qr',p_approved); end $$;
create or replace function public.owner_confirm_cash_payment(p_request_id uuid) returns void
language plpgsql security definer set search_path='' as $$ begin perform private.complete_owner_payment(p_request_id,'cash',true); end $$;
-- Final payment authority now belongs to the owner, not administrators.
revoke all on function public.admin_verify_payment(uuid,boolean) from public,anon,authenticated;

create or replace function public.cancel_rental_request(p_request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.rental_requests%rowtype; actor uuid := (select auth.uid());
begin
  if not private.account_is_active(actor) then raise exception 'Account access is suspended'; end if;
  select * into r from public.rental_requests where request_id=p_request_id and user_id=actor for update;
  if r.request_id is null then raise exception 'Request not found or access denied'; end if;
  if r.status='cancelled' then return; end if;
  if r.payment_status='paid' then raise exception 'Use the cancellation and 90 percent refund request'; end if;
  if r.status not in ('pending','awaiting_payment','awaiting_cash','payment_submitted') then raise exception 'This request can no longer be withdrawn'; end if;
  update public.rental_requests set status='cancelled',updated_at=now() where request_id=r.request_id;
end $$;

create or replace function public.request_booking_refund(p_request_id uuid,p_refund_qr_path text,p_gcash_name text,p_gcash_number text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare r public.rental_requests%rowtype; actor uuid := (select auth.uid()); total numeric;
begin
  if not private.account_is_active(actor) then raise exception 'Account access is suspended'; end if;
  if length(trim(coalesce(p_gcash_name,''))) not between 2 and 120 or trim(coalesce(p_gcash_number,''))!~'^(\+63|0)9[0-9]{9}$'
    or split_part(p_refund_qr_path,'/',1)<>actor::text then raise exception 'Enter the GCash account name, valid mobile number and your refund QR image'; end if;
  if not exists(select 1 from storage.objects where bucket_id='private_documents' and name=p_refund_qr_path) then raise exception 'Refund QR image was not uploaded'; end if;
  select * into r from public.rental_requests where request_id=p_request_id and user_id=actor for update;
  if r.request_id is null or r.payment_status<>'paid' or r.status not in ('approved','reserved','cancelled') then raise exception 'Only a confirmed paid booking is eligible for this refund request'; end if;
  total:=r.required_amount;
  if total is null or total<=0 or total>=1000000000 then raise exception 'The owner must correct the recorded payment amount before a refund'; end if;
  update public.rental_requests set status='refund_requested',renter_refund_qr_url=p_refund_qr_path,
    renter_gcash_name=trim(p_gcash_name),renter_gcash_number=trim(p_gcash_number),cancel_reason=nullif(left(trim(coalesce(p_reason,'')),500),''),
    refund_amount=round(total*0.90,2),refund_deduction=total-round(total*0.90,2),refund_requested_at=now(),updated_at=now() where request_id=r.request_id;
end $$;

create or replace function public.owner_submit_refund(p_request_id uuid,p_proof_path text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid := (select auth.uid());
begin
  if not private.account_is_active(actor) then raise exception 'Account access is suspended'; end if;
  if split_part(p_proof_path,'/',1)<>actor::text or not exists(select 1 from storage.objects where bucket_id='private_documents' and name=p_proof_path) then raise exception 'Upload your refund transfer proof first'; end if;
  update public.rental_requests set status='refund_sent',refund_proof_url=p_proof_path,refund_sent_at=now(),updated_at=now()
  where request_id=p_request_id and owner_id=actor and status='refund_requested';
  if not found then raise exception 'Refund request not found or already updated'; end if;
end $$;

create or replace function public.confirm_booking_refund(p_request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.rental_requests%rowtype; actor uuid := (select auth.uid());
begin
  if not private.account_is_active(actor) then raise exception 'Account access is suspended'; end if;
  select * into r from public.rental_requests where request_id=p_request_id and user_id=actor for update;
  if r.status='refund_completed' then return; end if;
  if r.request_id is null or r.status<>'refund_sent' or coalesce(r.refund_proof_url,'')='' then raise exception 'Wait for the owner to send refund proof'; end if;
  perform 1 from public.dorms where dorm_id=r.dorm_id for update;
  update public.rentals set status='past',end_date=now(),updated_at=now() where request_id=r.request_id and status='active';
  update public.rental_requests set status='refund_completed',refund_confirmed_at=now(),slot_allocated=false,updated_at=now() where request_id=r.request_id;
  if r.slot_allocated then update public.dorms set occupied_tenants=greatest(0,occupied_tenants-1),available=true,availability_status='available',updated_at=now() where dorm_id=r.dorm_id; end if;
end $$;
-- Retire old incomplete entry points instead of allowing bypass of account details.
revoke all on function public.request_reservation_refund(uuid,text,text) from public,anon,authenticated;
create or replace function public.confirm_reservation_refund(p_request_id uuid) returns void
language plpgsql security definer set search_path='' as $$ begin perform public.confirm_booking_refund(p_request_id); end $$;

create or replace function public.convert_reservation_to_rental(p_request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.rental_requests%rowtype; actor uuid := (select auth.uid());
begin
  if not private.account_is_active(actor) then raise exception 'Account access is suspended'; end if;
  select * into r from public.rental_requests where request_id=p_request_id and owner_id=actor for update;
  if r.request_id is null or r.status<>'reserved' or r.payment_status<>'paid' or not r.slot_allocated then raise exception 'A confirmed reservation is required'; end if;
  perform 1 from public.dorms where dorm_id=r.dorm_id and owner_id=actor for update;
  insert into public.rentals(dorm_id,user_id,request_id,status,start_date) values(r.dorm_id,r.user_id,r.request_id,'active',now());
  update public.rental_requests set status='approved',converted_at=now(),updated_at=now() where request_id=r.request_id;
  -- The reserved bed is reused. Occupancy is deliberately unchanged.
end $$;

create or replace function public.owner_release_reservation(p_request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.rental_requests%rowtype; actor uuid := (select auth.uid());
begin
  if not private.account_is_active(actor) then raise exception 'Account access is suspended'; end if;
  select * into r from public.rental_requests where request_id=p_request_id and owner_id=actor for update;
  if r.request_id is null or r.status<>'reserved' then raise exception 'Confirmed reservation not found'; end if;
  perform 1 from public.dorms where dorm_id=r.dorm_id for update;
  update public.rental_requests set status='cancelled',slot_allocated=false,cancel_reason='Reservation released by owner; renter may request the 90% refund.',updated_at=now() where request_id=r.request_id;
  if r.slot_allocated then update public.dorms set occupied_tenants=greatest(0,occupied_tenants-1),available=true,availability_status='available',updated_at=now() where dorm_id=r.dorm_id; end if;
end $$;

create or replace function public.owner_end_rental(p_rental_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t public.rentals%rowtype; r public.rental_requests%rowtype; actor uuid := (select auth.uid());
begin
  if not private.account_is_active(actor) then raise exception 'Account access is suspended'; end if;
  select x.* into t from public.rentals x join public.dorms d using(dorm_id) where x.rental_id=p_rental_id and d.owner_id=actor;
  if t.rental_id is null then raise exception 'Rental not found or access denied'; end if;
  if t.request_id is not null then select * into r from public.rental_requests where request_id=t.request_id for update; end if;
  perform 1 from public.dorms where dorm_id=t.dorm_id and owner_id=actor for update;
  select * into t from public.rentals where rental_id=p_rental_id for update;
  if t.status<>'active' then raise exception 'This tenancy has already ended'; end if;
  update public.rentals set status='past',end_date=now(),updated_at=now() where rental_id=t.rental_id;
  if t.request_id is not null then
    update public.rental_requests set status=case when status in ('refund_requested','refund_sent') then status else 'completed' end,
      slot_allocated=false,updated_at=now() where request_id=t.request_id;
  end if;
  update public.dorms set occupied_tenants=greatest(0,occupied_tenants-1),available=true,availability_status='available',updated_at=now() where dorm_id=t.dorm_id;
end $$;

create table if not exists public.rental_extensions(
  extension_id uuid primary key default gen_random_uuid(),rental_id uuid not null references public.rentals(rental_id) on delete cascade,
  previous_end_date timestamptz,new_end_date timestamptz not null,owner_id uuid not null references public.owners(owner_id),created_at timestamptz not null default now());
alter table public.rental_extensions enable row level security;
create policy rental_extensions_participant_read on public.rental_extensions for select to authenticated using(
  owner_id=(select auth.uid()) or private.is_admin() or exists(select 1 from public.rentals t where t.rental_id=rental_extensions.rental_id and t.user_id=(select auth.uid())));
grant select on public.rental_extensions to authenticated;
create index if not exists rental_extensions_rental_date on public.rental_extensions(rental_id,created_at desc);
create or replace function public.owner_extend_rental(p_rental_id uuid,p_end_date timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare t public.rentals%rowtype; actor uuid := (select auth.uid());
begin
  if not private.account_is_active(actor) then raise exception 'Account access is suspended'; end if;
  select x.* into t from public.rentals x join public.dorms d using(dorm_id) where x.rental_id=p_rental_id and d.owner_id=actor for update of x;
  if t.rental_id is null or t.status<>'active' then raise exception 'Active tenancy not found'; end if;
  if p_end_date is null or p_end_date<=greatest(now(),coalesce(t.planned_end_date,t.start_date)) or p_end_date>now()+interval '10 years' then raise exception 'Choose an end date after the current stay, within ten years'; end if;
  insert into public.rental_extensions(rental_id,previous_end_date,new_end_date,owner_id) values(t.rental_id,t.planned_end_date,p_end_date,actor);
  update public.rentals set planned_end_date=p_end_date,updated_at=now() where rental_id=t.rental_id;
  if t.user_id is not null then insert into public.notifications(user_id,title,message,type,related_dorm_id,related_request_id)
    values(t.user_id,'Stay extended','Your owner updated the planned end of your stay. See Bookings & history.','rental_extended',t.dorm_id,t.request_id); end if;
end $$;

create or replace function public.get_renter_booking_history() returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb) from(
  select r.*,jsonb_build_object('name',d.name,'address',d.address,'images',d.images,'price',d.price) dorms,
    (select to_jsonb(t) from public.rentals t where t.request_id=r.request_id order by t.start_date desc limit 1) tenancy
  from public.rental_requests r join public.dorms d using(dorm_id)
  where r.user_id=(select auth.uid()) and private.account_is_active((select auth.uid()))
)q $$;
create or replace function public.get_owner_tenant_history(p_dorm_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(to_jsonb(q) order by q.end_date desc),'[]'::jsonb) from(
  select t.*,jsonb_build_object('name',d.name) dorms,
    jsonb_build_object('full_name',p.full_name,'username',p.username,'avatar_url',p.avatar_url) renters,
    (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc),'[]'::jsonb) from public.rental_extensions e where e.rental_id=t.rental_id) extensions
  from public.rentals t join public.dorms d using(dorm_id) left join public.renters p on p.renter_id=t.user_id
  where d.owner_id=(select auth.uid()) and t.status='past' and (p_dorm_id is null or t.dorm_id=p_dorm_id) and private.account_is_active((select auth.uid()))
)q $$;
create or replace function public.get_owner_rental_dashboard(p_dorm_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object(
 'requests',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from(
   select r.*,jsonb_build_object('name',d.name,'price',d.price,'reservation_fee',d.reservation_fee) dorms,
     jsonb_build_object('full_name',p.full_name,'username',p.username,'avatar_url',p.avatar_url) profiles
   from public.rental_requests r join public.dorms d using(dorm_id) left join public.renters p on p.renter_id=r.user_id
   where d.owner_id=(select auth.uid()) and r.owner_id=(select auth.uid()) and(p_dorm_id is null or r.dorm_id=p_dorm_id) and private.account_is_active((select auth.uid()))
 )q),'[]'::jsonb),
 'tenants',coalesce((select jsonb_agg(to_jsonb(q) order by q.start_date desc) from(
   select t.*,jsonb_build_object('name',d.name) dorms,jsonb_build_object('full_name',p.full_name,'username',p.username,'avatar_url',p.avatar_url) renters
   from public.rentals t join public.dorms d using(dorm_id) left join public.renters p on p.renter_id=t.user_id
   where d.owner_id=(select auth.uid()) and t.status='active' and(p_dorm_id is null or t.dorm_id=p_dorm_id) and private.account_is_active((select auth.uid()))
 )q),'[]'::jsonb));
$$;

create or replace function private.notify_request_change() returns trigger language plpgsql security definer set search_path='' as $$
declare dorm_name text; recipient uuid; headline text; body text;
begin
  select name into dorm_name from public.dorms where dorm_id=new.dorm_id;
  if tg_op='INSERT' then
    insert into public.notifications(user_id,title,message,type,related_dorm_id,related_request_id) values(new.owner_id,'New dorm request','A renter submitted a request for '||dorm_name||'.','rental_request',new.dorm_id,new.request_id);
  elsif new.status is distinct from old.status then
    headline:=case new.status when 'refund_requested' then 'Cancellation and refund requested' when 'refund_sent' then 'Refund proof received' when 'refund_completed' then 'Refund confirmed' when 'completed' then 'Tenancy ended' when 'cancelled' then 'Request cancelled' else 'Booking updated' end;
    body:=dorm_name||': '||replace(new.status,'_',' ')||'.'||case when new.status='refund_requested' then ' A 90% refund is requested; 10% is deducted. No money is sent automatically.' when new.status='refund_sent' then ' Check your GCash account before confirming receipt.' when new.status='cancelled' and new.payment_status='paid' then ' The renter can request the recorded 90% refund in Bookings & history.' else '' end;
    foreach recipient in array array[new.user_id,new.owner_id] loop
      insert into public.notifications(user_id,title,message,type,related_dorm_id,related_request_id) values(recipient,headline,body,new.status,new.dorm_id,new.request_id);
    end loop;
  elsif new.status='cancelled' and new.payment_status is distinct from old.payment_status then
    insert into public.notifications(user_id,title,message,type,related_dorm_id,related_request_id) values(new.user_id,'Receipt reviewed',dorm_name||': your cancelled request receipt was '||case when new.payment_status='paid' then 'confirmed. You can request the 90% refund in Bookings & history.' else 'rejected.' end,'cancelled_payment_review',new.dorm_id,new.request_id);
  end if;
  return new;
end $$;

-- Postgres grants execute to PUBLIC by default; make every new entry point explicit.
do $$ declare signature text; begin
 foreach signature in array array[
  'public.owner_confirm_qr_payment(uuid,boolean)','public.owner_confirm_cash_payment(uuid)','public.cancel_rental_request(uuid)',
  'public.request_booking_refund(uuid,text,text,text,text)','public.owner_submit_refund(uuid,text)','public.confirm_booking_refund(uuid)',
  'public.confirm_reservation_refund(uuid)','public.convert_reservation_to_rental(uuid)','public.owner_release_reservation(uuid)',
  'public.owner_end_rental(uuid)','public.owner_extend_rental(uuid,timestamptz)','public.get_renter_booking_history()',
  'public.get_owner_tenant_history(uuid)','public.get_owner_rental_dashboard(uuid)'
 ] loop execute 'revoke all on function '||signature||' from public,anon'; execute 'grant execute on function '||signature||' to authenticated'; end loop;
end $$;
notify pgrst,'reload schema';
