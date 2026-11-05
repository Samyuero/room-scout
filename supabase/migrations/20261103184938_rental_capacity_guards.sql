-- Close the race between two devices submitting the same unpaid request.
create unique index rental_requests_one_open_per_renter_dorm
on public.rental_requests(user_id,dorm_id)
where status in ('pending','awaiting_payment','awaiting_cash','payment_submitted');
create unique index rentals_one_active_per_renter_dorm
on public.rentals(user_id,dorm_id) where status='active' and user_id is not null;

create or replace function public.cancel_rental_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.rental_requests%rowtype; release_slot boolean := false;
begin
  select * into r from public.rental_requests
  where request_id=p_request_id and user_id=(select auth.uid()) for update;
  if r.request_id is null then raise exception 'Request not found or access denied'; end if;
  if r.status='cancelled' then return; end if;
  if r.status not in ('pending','awaiting_payment','awaiting_cash','payment_submitted','approved','reserved') then
    raise exception 'This request can no longer be cancelled';
  end if;
  if r.status in ('approved','reserved') then
    perform 1 from public.dorms where dorm_id=r.dorm_id for update;
    release_slot := r.status='reserved' or exists (
      select 1 from public.rentals where dorm_id=r.dorm_id and user_id=r.user_id and status='active'
    );
  end if;
  update public.rental_requests set status='cancelled',updated_at=now() where request_id=r.request_id;
  -- A reservation must not end a separate rental belonging to the same renter.
  if r.status='approved' then
    update public.rentals set status='past',end_date=now(),updated_at=now()
    where dorm_id=r.dorm_id and user_id=r.user_id and status='active';
  end if;
  if release_slot then
    update public.dorms set occupied_tenants=greatest(0,occupied_tenants-1),
      available=true,availability_status='available',updated_at=now() where dorm_id=r.dorm_id;
  end if;
end $$;
revoke all on function public.cancel_rental_request(uuid) from public,anon;
grant execute on function public.cancel_rental_request(uuid) to authenticated;

-- Use the same dorm -> rental lock order as renter cancellation. Recheck the
-- active row after acquiring the dorm lock so concurrent ending is safe.
create or replace function public.owner_end_rental(p_rental_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare rental_row public.rentals%rowtype;
begin
  select rental.* into rental_row from public.rentals rental
  join public.dorms dorm on dorm.dorm_id=rental.dorm_id
  where rental.rental_id=p_rental_id and rental.status='active' and dorm.owner_id=(select auth.uid());
  if rental_row.rental_id is null then raise exception 'Active rental not found or access denied'; end if;
  perform 1 from public.dorms where dorm_id=rental_row.dorm_id and owner_id=(select auth.uid()) for update;
  if not found then raise exception 'Dorm not found or access denied'; end if;
  select * into rental_row from public.rentals where rental_id=p_rental_id and status='active' for update;
  if rental_row.rental_id is null then raise exception 'This tenancy has already ended'; end if;
  update public.rentals set status='past',end_date=now(),updated_at=now() where rental_id=p_rental_id;
  update public.dorms set occupied_tenants=greatest(0,occupied_tenants-1),
    available=true,availability_status='available',updated_at=now() where dorm_id=rental_row.dorm_id;
end $$;
revoke all on function public.owner_end_rental(uuid) from public,anon;
grant execute on function public.owner_end_rental(uuid) to authenticated;
notify pgrst,'reload schema';
