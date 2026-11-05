alter table public.rental_requests add column if not exists payment_method text not null default 'qr' check (payment_method in ('qr', 'cash'));
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


create or replace function public.get_owner_rental_dashboard(p_dorm_id uuid default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
select jsonb_build_object(
  'requests', coalesce((
    select jsonb_agg(to_jsonb(request_row) order by request_row.created_at desc)
    from (
      select r.*, jsonb_build_object('name', d.name, 'price', d.price, 'reservation_fee', d.reservation_fee) as dorms,
        jsonb_build_object('full_name', p.full_name, 'username', p.username, 'avatar_url', p.avatar_url) as profiles
      from public.rental_requests r
      join public.dorms d on d.dorm_id = r.dorm_id
      left join public.renters p on p.renter_id = r.user_id
      where d.owner_id = (select auth.uid()) and r.owner_id = (select auth.uid())
        and (p_dorm_id is null or d.dorm_id = p_dorm_id)
    ) request_row
  ), '[]'::jsonb),
  'tenants', coalesce((
    select jsonb_agg(to_jsonb(tenant_row) order by tenant_row.start_date desc)
    from (
      select r.*, jsonb_build_object('name', d.name) as dorms,
        jsonb_build_object('full_name', p.full_name, 'username', p.username, 'avatar_url', p.avatar_url) as renters
      from public.rentals r
      join public.dorms d on d.dorm_id = r.dorm_id
      left join public.renters p on p.renter_id = r.user_id
      where d.owner_id = (select auth.uid()) and r.status = 'active'
        and (p_dorm_id is null or d.dorm_id = p_dorm_id)
    ) tenant_row
  ), '[]'::jsonb)
);
$$;
revoke all on function public.get_owner_rental_dashboard(uuid) from public, anon;
grant execute on function public.get_owner_rental_dashboard(uuid) to authenticated;
notify pgrst, 'reload schema';
