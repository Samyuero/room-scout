alter table public.renters add column if not exists phone_number text check (phone_number is null or phone_number ~ '^\\+?[0-9][0-9 ()-]{6,19}$');
alter table public.owners add column if not exists phone_number text check (phone_number is null or phone_number ~ '^\\+?[0-9][0-9 ()-]{6,19}$');
alter table public.admins add column if not exists phone_number text check (phone_number is null or phone_number ~ '^\\+?[0-9][0-9 ()-]{6,19}$');

create or replace function private.ensure_renter_profile()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.renters(renter_id,full_name,avatar_url,updated_at)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name'),coalesce(new.raw_user_meta_data->>'avatar_url',new.raw_user_meta_data->>'picture'),now())
  on conflict(renter_id) do update set avatar_url=coalesce(nullif(public.renters.avatar_url,''),excluded.avatar_url);
  return new;
end $$;
revoke all on function private.ensure_renter_profile() from public,anon,authenticated;
create trigger ensure_renter_profile after insert or update of raw_user_meta_data on auth.users
for each row execute function private.ensure_renter_profile();
insert into public.renters(renter_id,full_name,avatar_url,updated_at)
select id,coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name'),coalesce(raw_user_meta_data->>'avatar_url',raw_user_meta_data->>'picture'),now() from auth.users
on conflict(renter_id) do update set avatar_url=coalesce(nullif(public.renters.avatar_url,''),excluded.avatar_url);
update public.owners p set avatar_url=coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture') from auth.users u where p.owner_id=u.id and nullif(p.avatar_url,'') is null;
update public.admins p set avatar_url=coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture') from auth.users u where p.admin_id=u.id and nullif(p.avatar_url,'') is null;
create policy admins_update_own_profile on public.admins for update to authenticated
using(admin_id=(select auth.uid())) with check(admin_id=(select auth.uid()));
grant update(full_name,username,avatar_url,phone_number,website,updated_at) on public.admins to authenticated;

alter table public.rental_requests drop constraint if exists rental_requests_status_check;
alter table public.rental_requests add constraint rental_requests_status_check check(status in ('pending','rejected','awaiting_payment','awaiting_cash','payment_submitted','approved','reserved','cancelled','refund_requested','refund_sent','refund_completed'));
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
     new.created_at <> old.created_at or new.payment_method is distinct from old.payment_method then
    raise exception 'Request participants and type cannot be changed';
  end if;
  if private.is_admin() then return new; end if;

  if actor = old.user_id then
    new.required_amount := old.required_amount;
    new.owner_payment_qr_url := old.owner_payment_qr_url;
    new.contract_url := old.contract_url;
    if old.status = 'pending' and new.status = 'cancelled' then return new; end if;
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
    if old.payment_method='cash' and old.status='pending' and new.status='awaiting_cash' then return new; end if;
    if old.payment_method='cash' and old.status='awaiting_cash' and new.status in ('approved','reserved') then return new; end if;
    if old.status = 'pending' and new.status = 'rejected' then return new; end if;
    if old.status = 'pending' and new.status = 'awaiting_payment' and
       new.required_amount > 0 and (new.payment_method = 'cash' or coalesce(trim(new.owner_payment_qr_url), '') <> '') and
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



create or replace function public.cancel_pending_request(p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.rental_requests set status='cancelled',updated_at=now() where request_id=p_request_id and user_id=(select auth.uid()) and status='pending';
  if not found then raise exception 'Only your pending request can be cancelled'; end if;
end $$;
revoke all on function public.cancel_pending_request(uuid) from public,anon;
grant execute on function public.cancel_pending_request(uuid) to authenticated;

create or replace function public.owner_accept_cash_request(p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.rental_requests r set status='awaiting_cash',
  required_amount=case when r.request_type='reservation' then d.reservation_fee else d.price end,updated_at=now()
  from public.dorms d where r.request_id=p_request_id and r.dorm_id=d.dorm_id and r.owner_id=(select auth.uid()) and d.owner_id=(select auth.uid()) and r.status='pending' and r.payment_method='cash';
  if not found then raise exception 'Pending cash request not found or access denied'; end if;
end $$;
revoke all on function public.owner_accept_cash_request(uuid) from public,anon;
grant execute on function public.owner_accept_cash_request(uuid) to authenticated;

create or replace function public.owner_confirm_cash_payment(p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.rental_requests%rowtype; capacity integer; occupied integer;
begin
  select * into r from public.rental_requests where request_id=p_request_id and owner_id=(select auth.uid()) and payment_method='cash' and status='awaiting_cash' for update;
  if r.request_id is null then raise exception 'Accepted cash request not found or access denied'; end if;
  select max_tenants,occupied_tenants into capacity,occupied from public.dorms where dorm_id=r.dorm_id and owner_id=(select auth.uid()) for update;
  if capacity is null or occupied>=capacity then raise exception 'No tenant slots are available'; end if;
  update public.rental_requests set status=case when request_type='reservation' then 'reserved' else 'approved' end,payment_status='paid',payment_verified_by=(select auth.uid()),payment_verified_at=now(),updated_at=now() where request_id=p_request_id;
  update public.dorms set occupied_tenants=occupied_tenants+1,available=occupied_tenants+1<max_tenants,availability_status=case when occupied_tenants+1<max_tenants then 'available' when r.request_type='reservation' then 'reserved' else 'unavailable' end,updated_at=now() where dorm_id=r.dorm_id;
  if r.request_type='rental' then insert into public.rentals(dorm_id,user_id,status,start_date) values(r.dorm_id,r.user_id,'active',now()); end if;
end $$;
revoke all on function public.owner_confirm_cash_payment(uuid) from public,anon;
grant execute on function public.owner_confirm_cash_payment(uuid) to authenticated;
notify pgrst,'reload schema';
