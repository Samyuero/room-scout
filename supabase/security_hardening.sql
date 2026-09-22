-- ROOM SCOUT SECURITY + TRANSACTION HARDENING
-- Apply after schema_v2.sql and capstone42_updates.sql.
-- This migration is non-destructive and can be applied to an existing project.

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins where admin_id = (select auth.uid())
  );
$$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

-- Columns required by the storyboard workflow.
alter table public.dorms
  add column if not exists approval_status text not null default 'pending',
  add column if not exists availability_status text not null default 'available',
  add column if not exists ownership_proof_url text,
  add column if not exists house_rules text[] not null default '{}',
  add column if not exists room_type text,
  add column if not exists furnished boolean not null default false,
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists owner_display_name text,
  add column if not exists max_tenants integer not null default 1,
  add column if not exists occupied_tenants integer not null default 0,
  add column if not exists reservation_fee numeric(10,2) not null default 0;

alter table public.dorms drop constraint if exists dorms_approval_status_check;
alter table public.dorms add constraint dorms_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected')) not valid;
alter table public.dorms validate constraint dorms_approval_status_check;
alter table public.dorms drop constraint if exists dorms_availability_status_check;
alter table public.dorms add constraint dorms_availability_status_check
  check (availability_status in ('available', 'reserved', 'unavailable')) not valid;
alter table public.dorms validate constraint dorms_availability_status_check;
alter table public.dorms drop constraint if exists dorms_reservation_fee_check;
alter table public.dorms add constraint dorms_reservation_fee_check check (reservation_fee >= 0) not valid;
alter table public.dorms validate constraint dorms_reservation_fee_check;
alter table public.dorms drop constraint if exists dorms_tenant_capacity_check;
alter table public.dorms add constraint dorms_tenant_capacity_check
  check (max_tenants >= 1 and max_tenants <= 500 and occupied_tenants >= 0 and occupied_tenants <= max_tenants) not valid;
alter table public.dorms validate constraint dorms_tenant_capacity_check;
alter table public.dorms drop constraint if exists dorms_contact_phone_check;
alter table public.dorms add constraint dorms_contact_phone_check
  check (contact_phone is null or contact_phone ~ '^\\+?[0-9][0-9 -]{6,19}$') not valid;
alter table public.dorms validate constraint dorms_contact_phone_check;

alter table public.dorm_reviews
  add column if not exists photos text[] not null default '{}';

alter table public.rental_requests
  add column if not exists request_type text not null default 'rental',
  add column if not exists required_amount numeric(10,2),
  add column if not exists owner_payment_qr_url text,
  add column if not exists contract_url text,
  add column if not exists renter_gcash_name text,
  add column if not exists renter_gcash_number text,
  add column if not exists renter_refund_qr_url text,
  add column if not exists cancel_reason text,
  add column if not exists refund_proof_url text,
  add column if not exists refund_sent_at timestamptz,
  add column if not exists contract_agreed boolean not null default false,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payment_verified_by uuid references public.admins(admin_id),
  add column if not exists payment_verified_at timestamptz;

update public.rental_requests set status = 'approved' where status = 'accepted';
update public.rental_requests set status = 'rejected' where status = 'declined';
alter table public.rental_requests drop constraint if exists rental_requests_status_check;
alter table public.rental_requests add constraint rental_requests_status_check check (
  status in (
    'pending', 'rejected', 'awaiting_payment', 'payment_submitted',
    'approved', 'reserved', 'cancelled', 'refund_requested',
    'refund_sent', 'refund_completed', 'refund_disputed'
  )
) not valid;
alter table public.rental_requests validate constraint rental_requests_status_check;
alter table public.rental_requests drop constraint if exists rental_requests_request_type_check;
alter table public.rental_requests add constraint rental_requests_request_type_check
  check (request_type in ('rental', 'reservation')) not valid;
alter table public.rental_requests validate constraint rental_requests_request_type_check;
alter table public.rental_requests drop constraint if exists rental_requests_payment_status_check;
alter table public.rental_requests add constraint rental_requests_payment_status_check
  check (payment_status in ('unpaid', 'pending_verification', 'paid', 'rejected')) not valid;
alter table public.rental_requests validate constraint rental_requests_payment_status_check;

alter table public.system_logs
  add column if not exists actor_id uuid references auth.users(id),
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Signup metadata may choose renter/owner onboarding only. Admin promotion is server-side.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text := coalesce(new.raw_user_meta_data ->> 'role', 'renter');
  safe_username text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  safe_name text := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
begin
  if requested_role = 'owner' then
    insert into public.owners (owner_id, username, full_name, updated_at)
    values (new.id, safe_username, safe_name, now())
    on conflict (owner_id) do nothing;
  else
    insert into public.renters (renter_id, username, full_name, updated_at)
    values (new.id, safe_username, safe_name, now())
    on conflict (renter_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Remove unsafe profile/admin policies from the draft schema.
drop policy if exists "Renters are viewable by everyone" on public.renters;
drop policy if exists "Users can insert their own renter profile" on public.renters;
drop policy if exists "Users can update own renter profile" on public.renters;
drop policy if exists "Owners are viewable by everyone" on public.owners;
drop policy if exists "Users can insert their own owner profile" on public.owners;
drop policy if exists "Users can update own owner profile" on public.owners;
drop policy if exists "Admins are viewable by everyone" on public.admins;
drop policy if exists "Users can insert their own admin profile" on public.admins;
drop policy if exists "Users can update own admin profile" on public.admins;

create policy "renters_select_own_or_admin" on public.renters for select to authenticated
  using ((select auth.uid()) = renter_id or private.is_admin());
create policy "renters_insert_own" on public.renters for insert to authenticated
  with check ((select auth.uid()) = renter_id);
create policy "renters_update_own" on public.renters for update to authenticated
  using ((select auth.uid()) = renter_id)
  with check ((select auth.uid()) = renter_id);

create policy "owners_select_own_or_admin" on public.owners for select to authenticated
  using ((select auth.uid()) = owner_id or private.is_admin());
create policy "owners_insert_own" on public.owners for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "owners_update_own" on public.owners for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "admins_select_admins" on public.admins for select to authenticated
  using (private.is_admin());
-- There is intentionally no client INSERT/UPDATE policy for admins.

-- Owners can submit listings, but cannot self-approve/certify/feature them.
create or replace function private.protect_dorm_review_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if private.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.approval_status := 'pending';
    new.lgu_certified := false;
    new.is_featured := false;
  else
    new.owner_id := old.owner_id;
    new.approval_status := old.approval_status;
    new.lgu_certified := old.lgu_certified;
    new.is_featured := old.is_featured;
  end if;
  return new;
end;
$$;
revoke all on function private.protect_dorm_review_fields() from public, anon, authenticated;

drop trigger if exists protect_dorm_review_fields on public.dorms;
create trigger protect_dorm_review_fields before insert or update on public.dorms
for each row execute function private.protect_dorm_review_fields();

drop policy if exists "Anyone can view available dorms" on public.dorms;
drop policy if exists "Owners can view their own dorms" on public.dorms;
drop policy if exists "Owners can insert their own dorms" on public.dorms;
drop policy if exists "Owners can update own dorms" on public.dorms;
drop policy if exists "Owners can delete own dorms" on public.dorms;

create policy "public_select_approved_dorms" on public.dorms for select to anon, authenticated
  using (approval_status = 'approved' and status = 'active');
create policy "owners_select_own_dorms" on public.dorms for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "admins_select_all_dorms" on public.dorms for select to authenticated
  using (private.is_admin());
create policy "owners_insert_pending_dorms" on public.dorms for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.owner_verifications verification
      where verification.user_id = (select auth.uid()) and verification.status = 'approved'
    )
    and approval_status = 'pending'
    and coalesce(trim(ownership_proof_url), '') <> ''
    and coalesce(lgu_certified, false) = false
  );
create policy "admins_insert_dorms" on public.dorms for insert to authenticated
  with check (private.is_admin());
create policy "owners_update_own_dorms" on public.dorms for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "admins_update_dorms" on public.dorms for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy "owners_delete_pending_dorms" on public.dorms for delete to authenticated
  using ((select auth.uid()) = owner_id and approval_status <> 'approved');

-- Enforce immutable participants and allowed request transitions.
create or replace function private.enforce_request_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare actor uuid := (select auth.uid());
begin
  if new.dorm_id <> old.dorm_id or new.user_id <> old.user_id or
     new.owner_id <> old.owner_id or new.request_type <> old.request_type or
     new.created_at <> old.created_at then
    raise exception 'Request participants and type cannot be changed';
  end if;
  if private.is_admin() then return new; end if;

  if actor = old.user_id then
    new.required_amount := old.required_amount;
    new.owner_payment_qr_url := old.owner_payment_qr_url;
    new.contract_url := old.contract_url;
    if old.status = 'rejected' and new.status = 'pending' then return new; end if;
    if old.status = 'awaiting_payment' and new.status = 'payment_submitted' and
       new.contract_agreed and coalesce(trim(new.payment_proof_url), '') <> '' then
      return new;
    end if;
    if old.status in ('approved', 'reserved') and new.status in ('cancelled', 'refund_requested') then
      return new;
    end if;
    if old.status = 'refund_sent' and new.status = 'refund_completed' then
      return new;
    end if;
  elsif actor = old.owner_id then
    new.renter_gov_id_url := old.renter_gov_id_url;
    new.payment_proof_url := old.payment_proof_url;
    new.contract_agreed := old.contract_agreed;
    if old.status = 'pending' and new.status = 'rejected' then return new; end if;
    if old.status = 'pending' and new.status = 'awaiting_payment' and
       new.required_amount > 0 and coalesce(trim(new.owner_payment_qr_url), '') <> '' and
       coalesce(trim(new.contract_url), '') <> '' then
      return new;
    end if;
    if old.status = 'refund_requested' and new.status = 'refund_sent' and
       coalesce(trim(new.refund_proof_url), '') <> '' then return new; end if;
  end if;
  raise exception 'Invalid request state transition for this user';
end;
$$;
revoke all on function private.enforce_request_transition() from public, anon, authenticated;

drop trigger if exists enforce_request_transition on public.rental_requests;
create trigger enforce_request_transition before update on public.rental_requests
for each row execute function private.enforce_request_transition();

drop policy if exists "Users can view their own rental requests" on public.rental_requests;
drop policy if exists "Users can insert their own rental requests" on public.rental_requests;
drop policy if exists "Users can update their own rental requests" on public.rental_requests;
create policy "request_participants_select" on public.rental_requests for select to authenticated
  using ((select auth.uid()) in (user_id, owner_id) or private.is_admin());
create policy "renters_insert_pending_requests" on public.rental_requests for insert to authenticated
  with check (
    (select auth.uid()) = user_id and status = 'pending'
    and owner_id = (select d.owner_id from public.dorms d where d.dorm_id = rental_requests.dorm_id)
  );
create policy "request_participants_update" on public.rental_requests for update to authenticated
  using ((select auth.uid()) in (user_id, owner_id) or private.is_admin())
  with check ((select auth.uid()) in (user_id, owner_id) or private.is_admin());

-- Database-generated notifications; clients cannot impersonate the system.
drop policy if exists "System can insert notifications" on public.notifications;
drop policy if exists "Users can view their own notifications" on public.notifications;
drop policy if exists "Users can update their own notifications" on public.notifications;
create policy "notifications_select_own" on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "notifications_update_own" on public.notifications for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function private.notify_request_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare dorm_name text;
begin
  select name into dorm_name from public.dorms where dorm_id = new.dorm_id;
  if tg_op = 'INSERT' then
    insert into public.notifications(user_id, title, message, type, related_dorm_id, related_request_id)
    values (new.owner_id, 'New dorm request', 'A renter submitted a request for ' || dorm_name || '.', 'rental_request', new.dorm_id, new.request_id);
  elsif new.status is distinct from old.status then
    if new.status in ('awaiting_payment', 'rejected', 'approved', 'reserved', 'refund_sent', 'refund_completed') then
      insert into public.notifications(user_id, title, message, type, related_dorm_id, related_request_id)
      values (new.user_id, 'Request updated', dorm_name || ' is now at step: ' || replace(new.status, '_', ' ') || '.', new.status, new.dorm_id, new.request_id);
    elsif new.status in ('payment_submitted', 'refund_requested') then
      insert into public.notifications(user_id, title, message, type, related_dorm_id, related_request_id)
      values (new.owner_id, 'Request action needed', dorm_name || ' is now at step: ' || replace(new.status, '_', ' ') || '.', new.status, new.dorm_id, new.request_id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.notify_request_change() from public, anon, authenticated;
drop trigger if exists notify_request_change on public.rental_requests;
create trigger notify_request_change after insert or update on public.rental_requests
for each row execute function private.notify_request_change();

-- Admin-only, atomic payment confirmation.
create or replace function public.admin_verify_payment(p_request_id uuid, p_approved boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.rental_requests%rowtype;
  capacity integer;
  occupied integer;
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  select * into request_row from public.rental_requests where request_id = p_request_id for update;
  if request_row.request_id is null or request_row.status <> 'payment_submitted' then
    raise exception 'Request is not awaiting payment verification';
  end if;
  if not request_row.contract_agreed or coalesce(trim(request_row.payment_proof_url), '') = '' then
    raise exception 'Contract agreement and payment proof are required';
  end if;

  if p_approved then
    select max_tenants, occupied_tenants into capacity, occupied
    from public.dorms where dorm_id = request_row.dorm_id for update;
    if occupied >= capacity then raise exception 'This dorm has reached its tenant capacity'; end if;
    update public.rental_requests set
      status = case when request_type = 'reservation' then 'reserved' else 'approved' end,
      payment_status = 'paid', payment_verified_by = (select auth.uid()),
      payment_verified_at = now(), updated_at = now()
    where request_id = p_request_id;
    update public.dorms set
      occupied_tenants = least(max_tenants, occupied_tenants + 1),
      available = occupied_tenants + 1 < max_tenants,
      availability_status = case
        when occupied_tenants + 1 < max_tenants then 'available'
        when request_row.request_type = 'reservation' then 'reserved'
        else 'unavailable'
      end,
      updated_at = now()
    where dorm_id = request_row.dorm_id;
    if request_row.request_type = 'rental' then
      insert into public.rentals(dorm_id, user_id, status, start_date)
      values (request_row.dorm_id, request_row.user_id, 'active', now());
    end if;
  else
    update public.rental_requests set status = 'awaiting_payment', payment_status = 'rejected',
      payment_proof_url = null, contract_agreed = false, updated_at = now()
    where request_id = p_request_id;
  end if;
end;
$$;
revoke all on function public.admin_verify_payment(uuid, boolean) from public, anon;
grant execute on function public.admin_verify_payment(uuid, boolean) to authenticated;

-- Renter cancellation and refund completion keep capacity updates atomic.
create or replace function public.request_reservation_refund(
  p_request_id uuid,
  p_refund_qr_path text,
  p_cancel_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(trim(p_refund_qr_path), '') = '' then
    raise exception 'A refund QR image is required';
  end if;
  update public.rental_requests
  set status = 'refund_requested',
      renter_refund_qr_url = p_refund_qr_path,
      cancel_reason = nullif(left(trim(coalesce(p_cancel_reason, '')), 500), ''),
      updated_at = now()
  where request_id = p_request_id
    and user_id = (select auth.uid())
    and request_type = 'reservation'
    and status = 'reserved';
  if not found then raise exception 'No confirmed reservation is eligible for refund'; end if;
end;
$$;
revoke all on function public.request_reservation_refund(uuid, text, text) from public, anon;
grant execute on function public.request_reservation_refund(uuid, text, text) to authenticated;

create or replace function public.confirm_reservation_refund(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare request_row public.rental_requests%rowtype;
begin
  select * into request_row
  from public.rental_requests
  where request_id = p_request_id and user_id = (select auth.uid())
  for update;
  if request_row.request_id is null or request_row.status <> 'refund_sent' then
    raise exception 'The owner has not submitted refund proof';
  end if;
  update public.rental_requests
  set status = 'refund_completed', updated_at = now()
  where request_id = p_request_id;
  update public.dorms
  set occupied_tenants = greatest(0, occupied_tenants - 1),
      available = true,
      availability_status = 'available',
      updated_at = now()
  where dorm_id = request_row.dorm_id;
end;
$$;
revoke all on function public.confirm_reservation_refund(uuid) from public, anon;
grant execute on function public.confirm_reservation_refund(uuid) to authenticated;

create or replace function public.cancel_active_rental(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare request_row public.rental_requests%rowtype;
begin
  select * into request_row
  from public.rental_requests
  where request_id = p_request_id and user_id = (select auth.uid())
  for update;
  if request_row.request_id is null or request_row.status <> 'approved' then
    raise exception 'No active rental request can be cancelled';
  end if;
  update public.rental_requests set status = 'cancelled', updated_at = now()
  where request_id = p_request_id;
  update public.rentals set status = 'past', end_date = now(), updated_at = now()
  where dorm_id = request_row.dorm_id and user_id = request_row.user_id and status = 'active';
  update public.dorms
  set occupied_tenants = greatest(0, occupied_tenants - 1),
      available = true,
      availability_status = 'available',
      updated_at = now()
  where dorm_id = request_row.dorm_id;
end;
$$;
revoke all on function public.cancel_active_rental(uuid) from public, anon;
grant execute on function public.cancel_active_rental(uuid) to authenticated;

-- Owners can add or end manual/offline tenancies without exceeding max_tenants.
create or replace function public.owner_add_offline_tenant(
  p_dorm_id uuid,
  p_renter_name text,
  p_renter_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_rental_id uuid;
  capacity integer;
  occupied integer;
begin
  if coalesce(trim(p_renter_name), '') = '' then raise exception 'Tenant name is required'; end if;
  select max_tenants, occupied_tenants into capacity, occupied
  from public.dorms
  where dorm_id = p_dorm_id and owner_id = (select auth.uid())
  for update;
  if capacity is null then raise exception 'Dorm not found or access denied'; end if;
  if occupied >= capacity then raise exception 'This dorm has reached its tenant capacity'; end if;
  insert into public.rentals(dorm_id, renter_name, renter_phone, status, start_date)
  values (p_dorm_id, left(trim(p_renter_name), 120), nullif(left(trim(coalesce(p_renter_phone, '')), 30), ''), 'active', now())
  returning rental_id into new_rental_id;
  update public.dorms
  set occupied_tenants = occupied_tenants + 1,
      available = occupied_tenants + 1 < max_tenants,
      availability_status = case when occupied_tenants + 1 < max_tenants then 'available' else 'unavailable' end,
      updated_at = now()
  where dorm_id = p_dorm_id;
  return new_rental_id;
end;
$$;
revoke all on function public.owner_add_offline_tenant(uuid, text, text) from public, anon;
grant execute on function public.owner_add_offline_tenant(uuid, text, text) to authenticated;

create or replace function public.owner_end_rental(p_rental_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare rental_row public.rentals%rowtype;
begin
  select rental.* into rental_row
  from public.rentals rental
  join public.dorms dorm on dorm.dorm_id = rental.dorm_id
  where rental.rental_id = p_rental_id
    and rental.status = 'active'
    and dorm.owner_id = (select auth.uid())
  for update of rental;
  if rental_row.rental_id is null then raise exception 'Active rental not found or access denied'; end if;
  update public.rentals set status = 'past', end_date = now(), updated_at = now()
  where rental_id = p_rental_id;
  update public.dorms
  set occupied_tenants = greatest(0, occupied_tenants - 1),
      available = true,
      availability_status = 'available',
      updated_at = now()
  where dorm_id = rental_row.dorm_id;
end;
$$;
revoke all on function public.owner_end_rental(uuid) from public, anon;
grant execute on function public.owner_end_rental(uuid) to authenticated;

-- Expose only review presentation fields. Search/AI clients never receive reviewer IDs,
-- private renter preferences, email addresses, phone numbers, or other users' inputs.
create or replace function public.get_public_dorm_reviews(p_dorm_id uuid)
returns table (
  review_id uuid,
  rating integer,
  comment text,
  photos text[],
  created_at timestamptz,
  reviewer_name text,
  reviewer_avatar_url text,
  verified_renter boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    review.review_id,
    review.rating,
    review.comment,
    review.photos,
    review.created_at,
    coalesce(nullif(trim(renter.full_name), ''), nullif(trim(renter.username), ''), 'Room Scout renter'),
    renter.avatar_url,
    exists (
      select 1 from public.rentals rental
      where rental.dorm_id = review.dorm_id
        and rental.user_id = review.user_id
        and rental.status in ('active', 'past')
    )
  from public.dorm_reviews review
  left join public.renters renter on renter.renter_id = review.user_id
  where review.dorm_id = p_dorm_id
  order by review.created_at desc;
$$;
revoke all on function public.get_public_dorm_reviews(uuid) from public;
grant execute on function public.get_public_dorm_reviews(uuid) to anon, authenticated;

drop policy if exists "System can insert logs" on public.system_logs;
drop policy if exists "Admins can view system logs" on public.system_logs;
create policy "admins_read_system_logs" on public.system_logs for select to authenticated
  using (private.is_admin());
-- No client INSERT policy for audit logs.

-- Support tickets are created by the reporting account and managed only by admins.
drop policy if exists "Users can view own support tickets" on public.support_tickets;
drop policy if exists "Users can insert own support tickets" on public.support_tickets;
drop policy if exists "Admins can view all support tickets" on public.support_tickets;
drop policy if exists "Admins can update any support ticket" on public.support_tickets;
create policy "support_ticket_reporters_select_own" on public.support_tickets for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "support_ticket_reporters_insert_own" on public.support_tickets for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "support_ticket_admins_select" on public.support_tickets for select to authenticated
  using (private.is_admin());
create policy "support_ticket_admins_update" on public.support_tickets for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Review ownership checks include WITH CHECK and prevent review identity reassignment.
drop policy if exists "Users can update own dorm review" on public.dorm_reviews;
create policy "renters_update_own_review" on public.dorm_reviews for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Storage validation is enforced both by the app and the bucket.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('uploaded_images', 'uploaded_images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public_read_listing_images" on storage.objects;
drop policy if exists "users_upload_own_listing_images" on storage.objects;
drop policy if exists "users_delete_own_listing_images" on storage.objects;
create policy "public_read_listing_images" on storage.objects for select to anon, authenticated
  using (bucket_id = 'uploaded_images');
create policy "users_upload_own_listing_images" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploaded_images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "users_delete_own_listing_images" on storage.objects for delete to authenticated
  using (bucket_id = 'uploaded_images' and (storage.foldername(name))[1] = (select auth.uid())::text);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('private_documents', 'private_documents', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "users_upload_own_private_documents" on storage.objects;
drop policy if exists "users_read_own_private_documents" on storage.objects;
drop policy if exists "admins_read_private_documents" on storage.objects;
drop policy if exists "request_participants_read_private_documents" on storage.objects;
create policy "users_upload_own_private_documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'private_documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "users_read_own_private_documents" on storage.objects for select to authenticated
  using (bucket_id = 'private_documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "admins_read_private_documents" on storage.objects for select to authenticated
  using (bucket_id = 'private_documents' and private.is_admin());
create policy "request_participants_read_private_documents" on storage.objects for select to authenticated
  using (
    bucket_id = 'private_documents' and exists (
      select 1 from public.rental_requests request
      where request.owner_id = (select auth.uid())
        and (
          request.renter_gov_id_url = storage.objects.name
          or request.payment_proof_url = storage.objects.name
          or request.owner_payment_qr_url = storage.objects.name
          or request.renter_refund_qr_url = storage.objects.name
          or request.refund_proof_url = storage.objects.name
        )
    )
  );

-- Explicit Data API grants are required for new Supabase projects from May 2026.
grant select on public.dorms, public.dorm_reviews to anon, authenticated;
grant select, insert, update on public.renters, public.owners to authenticated;
grant select on public.admins to authenticated;
grant select, insert, update on public.rental_requests to authenticated;
grant select, update on public.notifications to authenticated;
grant select on public.owner_verifications, public.rentals, public.support_tickets, public.system_logs to authenticated;
grant insert on public.owner_verifications, public.support_tickets to authenticated;
grant update on public.owner_verifications, public.rentals, public.support_tickets, public.dorms, public.dorm_reviews to authenticated;
grant insert on public.dorms, public.dorm_reviews, public.rentals to authenticated;
grant delete on public.dorms, public.dorm_reviews to authenticated;

create index if not exists dorms_discovery_idx on public.dorms(approval_status, status, availability_status, price);
create index if not exists dorms_coordinates_idx on public.dorms(latitude, longitude);
create index if not exists dorm_reviews_dorm_created_idx on public.dorm_reviews(dorm_id, created_at desc);
create index if not exists rental_requests_owner_status_idx on public.rental_requests(owner_id, status, updated_at desc);
create index if not exists rental_requests_user_status_idx on public.rental_requests(user_id, status, updated_at desc);
create index if not exists notifications_user_read_idx on public.notifications(user_id, read, created_at desc);

commit;
