-- Cancellation is independent of cash/QR and payment confirmation. Money is
-- never refunded by this RPC. Existing receipts remain available for review.
create or replace function public.cancel_rental_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.rental_requests%rowtype; release_slot boolean := false;
begin
  select * into r from public.rental_requests
  where request_id = p_request_id and user_id = (select auth.uid()) for update;
  if r.request_id is null then raise exception 'Request not found or access denied'; end if;
  if r.status = 'cancelled' then return; end if; -- Safe retry after a lost response.
  if r.status not in ('pending','awaiting_payment','awaiting_cash','payment_submitted','approved','reserved') then
    raise exception 'This request can no longer be cancelled';
  end if;

  -- Confirmations and cancellation lock the request first, then its dorm.
  -- Only confirmed stays ever consumed a slot; unpaid requests must not free one.
  if r.status in ('approved','reserved') then
    perform 1 from public.dorms where dorm_id = r.dorm_id for update;
    release_slot := r.status = 'reserved' or exists (
      select 1 from public.rentals where dorm_id = r.dorm_id and user_id = r.user_id and status = 'active'
    );
  end if;
  update public.rental_requests set status = 'cancelled', updated_at = now()
  where request_id = r.request_id;
  if r.status in ('approved','reserved') then
    update public.rentals set status = 'past', end_date = now(), updated_at = now()
    where dorm_id = r.dorm_id and user_id = r.user_id and status = 'active';
    if release_slot then
      update public.dorms set occupied_tenants = greatest(0, occupied_tenants - 1),
        available = true, availability_status = 'available', updated_at = now()
      where dorm_id = r.dorm_id;
    end if;
  end if;
end $$;
revoke all on function public.cancel_rental_request(uuid) from public, anon;
grant execute on function public.cancel_rental_request(uuid) to authenticated;

-- Keep older installed clients compatible with the same atomic cancellation.
create or replace function public.cancel_pending_request(p_request_id uuid)
returns void language sql security definer set search_path = '' as $$
  select public.cancel_rental_request(p_request_id);
$$;
create or replace function public.cancel_active_rental(p_request_id uuid)
returns void language sql security definer set search_path = '' as $$
  select public.cancel_rental_request(p_request_id);
$$;
revoke all on function public.cancel_pending_request(uuid), public.cancel_active_rental(uuid) from public, anon;
grant execute on function public.cancel_pending_request(uuid), public.cancel_active_rental(uuid) to authenticated;

create or replace function private.enforce_request_transition()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare actor uuid := (select auth.uid());
  direct_client boolean := current_user in ('authenticated','anon');
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.payment_status <> 'unpaid'
      or new.payment_verified_by is not null or new.payment_verified_at is not null
      or new.payment_proof_url is not null or coalesce(new.contract_agreed, false) then
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

  -- Capacity/payment confirmation must use an authorized atomic RPC, not a
  -- direct table update that could skip tenancy/capacity bookkeeping.
  if direct_client then
    if new.payment_verified_by is distinct from old.payment_verified_by
      or new.payment_verified_at is distinct from old.payment_verified_at
      or (new.payment_status is distinct from old.payment_status and
        not (actor = old.user_id and old.status = 'awaiting_payment'
          and new.status = 'payment_submitted' and new.payment_status = 'pending_verification'))
      or (new.status is distinct from old.status and
        (new.status in ('approved','reserved','cancelled','refund_completed')
          or old.status in ('approved','reserved'))) then
      raise exception 'Use the authorized payment or cancellation action';
    end if;
  end if;
  if private.is_admin() then return new; end if;

  if actor = old.user_id then
    new.required_amount := old.required_amount;
    new.owner_payment_qr_url := old.owner_payment_qr_url;
    new.contract_url := old.contract_url;
    new.renter_gov_id_url := old.renter_gov_id_url;
    if old.status in ('pending','awaiting_payment','awaiting_cash','payment_submitted','approved','reserved')
      and new.status = 'cancelled' and not direct_client then
      new.payment_status := old.payment_status;
      new.payment_verified_by := old.payment_verified_by;
      new.payment_verified_at := old.payment_verified_at;
      new.payment_proof_url := old.payment_proof_url;
      new.contract_agreed := old.contract_agreed;
      return new;
    end if;
    if old.status = 'awaiting_payment' and new.status = 'payment_submitted'
      and old.payment_method = 'qr' and new.contract_agreed
      and coalesce(trim(new.payment_proof_url), '') <> '' then return new; end if;
    if old.status = 'reserved' and new.status = 'refund_requested' and not direct_client then return new; end if;
    if old.status = 'refund_sent' and new.status = 'refund_completed' and not direct_client then return new; end if;
  elsif actor = old.owner_id then
    new.renter_gov_id_url := old.renter_gov_id_url;
    new.payment_proof_url := old.payment_proof_url;
    new.contract_agreed := old.contract_agreed;
    if old.payment_method = 'cash' and old.status = 'pending' and new.status = 'awaiting_cash' then return new; end if;
    if old.payment_method = 'cash' and old.status = 'awaiting_cash'
      and new.status in ('approved','reserved') and not direct_client then return new; end if;
    if old.status = 'pending' and new.status = 'rejected' then return new; end if;
    if old.status = 'pending' and new.status = 'awaiting_payment' and old.payment_method = 'qr'
      and new.required_amount > 0 and coalesce(trim(new.owner_payment_qr_url), '') <> ''
      and coalesce(trim(new.contract_url), '') <> '' then return new; end if;
    if old.status = 'refund_requested' and new.status = 'refund_sent'
      and coalesce(trim(new.refund_proof_url), '') <> '' then return new; end if;
  end if;
  raise exception 'This request changed. Refresh before trying again';
end $$;
revoke all on function private.enforce_request_transition() from public, anon, authenticated;
drop trigger if exists enforce_request_insert on public.rental_requests;
create trigger enforce_request_insert before insert on public.rental_requests
for each row execute function private.enforce_request_transition();

create or replace function public.admin_verify_payment(p_request_id uuid, p_approved boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.rental_requests%rowtype; capacity integer; occupied integer;
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  select * into r from public.rental_requests where request_id = p_request_id for update;
  if r.request_id is null or r.payment_status <> 'pending_verification'
    or r.status not in ('payment_submitted','cancelled') then
    raise exception 'Request is not awaiting payment verification';
  end if;
  if not coalesce(r.contract_agreed, false) or coalesce(trim(r.payment_proof_url), '') = '' then
    raise exception 'Contract agreement and payment proof are required';
  end if;

  -- A withdrawn request may still contain a real payment. Review the receipt
  -- without reviving the request, allocating a bed, or issuing any refund.
  if r.status = 'cancelled' then
    update public.rental_requests set payment_status = case when p_approved then 'paid' else 'rejected' end,
      payment_verified_by = (select auth.uid()), payment_verified_at = now(), updated_at = now()
    where request_id = p_request_id;
    return;
  end if;
  if p_approved then
    select max_tenants, occupied_tenants into capacity, occupied
    from public.dorms where dorm_id = r.dorm_id for update;
    if capacity is null or occupied >= capacity then raise exception 'This dorm has reached its tenant capacity'; end if;
    update public.rental_requests set status = case when request_type = 'reservation' then 'reserved' else 'approved' end,
      payment_status = 'paid', payment_verified_by = (select auth.uid()), payment_verified_at = now(), updated_at = now()
    where request_id = p_request_id;
    update public.dorms set occupied_tenants = occupied_tenants + 1,
      available = occupied_tenants + 1 < max_tenants,
      availability_status = case when occupied_tenants + 1 < max_tenants then 'available'
        when r.request_type = 'reservation' then 'reserved' else 'unavailable' end, updated_at = now()
    where dorm_id = r.dorm_id;
    if r.request_type = 'rental' then
      insert into public.rentals(dorm_id,user_id,status,start_date) values(r.dorm_id,r.user_id,'active',now());
    end if;
  else
    update public.rental_requests set status = 'awaiting_payment', payment_status = 'rejected',
      payment_proof_url = null, contract_agreed = false, updated_at = now() where request_id = p_request_id;
  end if;
end $$;
revoke all on function public.admin_verify_payment(uuid, boolean) from public, anon;
grant execute on function public.admin_verify_payment(uuid, boolean) to authenticated;

create or replace function private.notify_request_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare dorm_name text; cancellation_type text;
begin
  select name into dorm_name from public.dorms where dorm_id = new.dorm_id;
  if tg_op = 'INSERT' then
    insert into public.notifications(user_id,title,message,type,related_dorm_id,related_request_id)
    values(new.owner_id,'New dorm request','A renter submitted a request for '||dorm_name||'.','rental_request',new.dorm_id,new.request_id);
  elsif new.status is distinct from old.status then
    if new.status = 'cancelled' then
      cancellation_type := case when old.status in ('approved','reserved') then 'cancelled' else 'request_cancelled' end;
      insert into public.notifications(user_id,title,message,type,related_dorm_id,related_request_id)
      values(new.owner_id,'Request cancelled',dorm_name||': the renter cancelled. No refund was issued by RoomScout. Any payment return must be arranged directly.',cancellation_type,new.dorm_id,new.request_id),
        (new.user_id,'Cancellation confirmed',dorm_name||': your request is cancelled. RoomScout does not issue refunds. Contact the owner directly about any payment return.',cancellation_type,new.dorm_id,new.request_id);
    elsif new.status in ('awaiting_payment','awaiting_cash','rejected','approved','reserved','refund_sent','refund_completed') then
      insert into public.notifications(user_id,title,message,type,related_dorm_id,related_request_id)
      values(new.user_id,'Request updated',dorm_name||' is now at step: '||replace(new.status,'_',' ')||'.',new.status,new.dorm_id,new.request_id);
    elsif new.status in ('payment_submitted','refund_requested') then
      insert into public.notifications(user_id,title,message,type,related_dorm_id,related_request_id)
      values(new.owner_id,'Request action needed',dorm_name||' is now at step: '||replace(new.status,'_',' ')||'.',new.status,new.dorm_id,new.request_id);
    end if;
  elsif new.status = 'cancelled' and new.payment_status is distinct from old.payment_status then
    insert into public.notifications(user_id,title,message,type,related_dorm_id,related_request_id)
    values(new.user_id,'Cancelled request: receipt reviewed',dorm_name||': payment proof was '||case when new.payment_status='paid' then 'verified' else 'rejected' end||'. Your request remains cancelled. No refund was issued.','cancelled_payment_review',new.dorm_id,new.request_id),
      (new.owner_id,'Cancelled request: receipt reviewed',dorm_name||': the receipt was reviewed. No tenancy or refund was created. Arrange any return directly with the renter.','cancelled_payment_review',new.dorm_id,new.request_id);
  end if;
  return new;
end $$;
revoke all on function private.notify_request_change() from public, anon, authenticated;
notify pgrst, 'reload schema';
