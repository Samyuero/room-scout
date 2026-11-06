-- Owner identity review and LGU review remain separate from publishing a listing.
create or replace function private.is_verified_owner(p_owner_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.owners o
    join public.owner_verifications v on v.user_id = o.owner_id
    where o.owner_id = p_owner_id and o.status = 'active' and v.status = 'approved');
$$;
revoke all on function private.is_verified_owner(uuid) from public, anon;
grant execute on function private.is_verified_owner(uuid) to authenticated;

create or replace function private.protect_owner_account_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') or private.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'active';
  elsif new.status is distinct from old.status then
    raise exception 'Only an administrator may change owner account status.';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_owner_account_status() from public, anon, authenticated;
create trigger protect_owner_account_status before insert or update on public.owners
for each row execute function private.protect_owner_account_status();

create or replace function private.protect_dorm_review_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') or private.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.approval_status := 'approved';
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
alter table public.dorms alter column approval_status set default 'approved';
drop policy if exists owners_insert_pending_dorms on public.dorms;
create policy verified_owners_publish_dorms on public.dorms for insert to authenticated
with check ((select auth.uid()) = owner_id
  and (select private.is_verified_owner())
  and approval_status = 'approved'
  and coalesce(trim(ownership_proof_url), '') <> ''
  and not coalesce(lgu_certified, false) and not coalesce(is_featured, false));

-- Existing pending submissions from already verified owners need no listing review.
update public.dorms d set approval_status = 'approved', updated_at = now()
where d.approval_status = 'pending' and private.is_verified_owner(d.owner_id);

create index if not exists rental_requests_demand_inquiries_idx
  on public.rental_requests (dorm_id, created_at);
create index if not exists rental_requests_demand_bookings_idx
  on public.rental_requests (dorm_id, payment_verified_at)
  where payment_verified_at is not null;

-- Public demand data is aggregate-only. No renter identities or documents are returned.
create or replace function public.get_public_demand_history(p_dorm_ids uuid[], p_days integer default 90)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(stats)), '[]'::jsonb) from (
    select d.dorm_id,
      (select count(*)::integer from public.rental_requests r where r.dorm_id=d.dorm_id
        and r.created_at >= now() - interval '30 days') as inquiries_30d,
      (select count(*)::integer from public.rental_requests r where r.dorm_id=d.dorm_id
        and r.created_at >= now() - interval '60 days' and r.created_at < now() - interval '30 days') as prior_inquiries_30d,
      (select count(*)::integer from public.rental_requests r where r.dorm_id=d.dorm_id
        and r.payment_verified_at >= now() - interval '30 days' and r.payment_status='paid') as bookings_30d,
      (select count(*)::integer from public.rental_requests r where r.dorm_id=d.dorm_id
        and r.payment_verified_at >= now() - interval '60 days' and r.payment_verified_at < now() - interval '30 days'
        and r.payment_status='paid') as prior_bookings_30d,
      least(greatest(coalesce(p_days,90),1),365,
        greatest(0, floor(extract(epoch from (now()-d.created_at))/86400)::integer)) as observed_days
    from public.dorms d where d.dorm_id = any(coalesce(p_dorm_ids,'{}'::uuid[]))
      and d.approval_status='approved' and d.status='active'
      and (select auth.uid()) is not null
    order by d.dorm_id limit 100
  ) stats;
$$;
revoke all on function public.get_public_demand_history(uuid[],integer) from public, anon;
grant execute on function public.get_public_demand_history(uuid[],integer) to authenticated;
notify pgrst, 'reload schema';
