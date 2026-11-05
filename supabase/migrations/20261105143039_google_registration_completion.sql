-- Every account retains a baseline renter identity for preferences/reviews.
-- Its presence alone is NOT a completed renter-role registration.
alter table public.renters add column registration_role text
  check (registration_role is null or registration_role in ('renter','owner'));
alter table public.renters add column registration_completed_at timestamptz;

-- Preserve existing manual registrations and existing owner accounts. Legacy
-- Google-only renter accounts complete the new role/details form once.
update public.renters r set registration_role=case when exists(
  select 1 from public.owners o where o.owner_id=r.renter_id
) then 'owner' else 'renter' end, registration_completed_at=now()
from auth.users u where u.id=r.renter_id
  and nullif(btrim(r.username),'') is not null and nullif(btrim(r.full_name),'') is not null
  and (exists(select 1 from public.owners o where o.owner_id=r.renter_id)
    or u.raw_user_meta_data->>'role' in ('renter','owner')
    or coalesce(u.raw_app_meta_data->>'provider','email')<>'google');

create or replace function private.protect_registration_completion()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if current_user in ('authenticated','anon') and (
    (tg_op='INSERT' and (new.registration_role is not null or new.registration_completed_at is not null))
    or (tg_op='UPDATE' and (new.registration_role is distinct from old.registration_role
      or new.registration_completed_at is distinct from old.registration_completed_at))
  ) then raise exception 'Complete registration using the account setup action'; end if;
  return new;
end $$;
revoke all on function private.protect_registration_completion() from public,anon,authenticated;
create trigger protect_registration_completion before insert or update on public.renters
for each row execute function private.protect_registration_completion();

create or replace function private.finish_manual_registration()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if coalesce(new.raw_app_meta_data->>'provider','email')='email'
    and new.raw_user_meta_data->>'role' in ('renter','owner')
    and lower(btrim(new.raw_user_meta_data->>'username')) ~ '^[a-z0-9_]{3,30}$'
    and length(btrim(new.raw_user_meta_data->>'full_name')) between 1 and 120 then
    update public.renters set registration_role=new.raw_user_meta_data->>'role',
      registration_completed_at=now() where renter_id=new.id;
  end if;
  return new;
end $$;
revoke all on function private.finish_manual_registration() from public,anon,authenticated;
-- Auth AFTER triggers run alphabetically, after the baseline/profile triggers.
create trigger z_finish_manual_registration after insert on auth.users
for each row execute function private.finish_manual_registration();

create or replace function public.complete_account_registration(
  p_full_name text, p_username text, p_role text, p_phone text default null
)
returns void language plpgsql security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  clean_name text := nullif(btrim(p_full_name),'');
  clean_username text := lower(nullif(btrim(p_username),''));
  clean_phone text := nullif(btrim(p_phone),'');
  saved public.renters%rowtype;
  google_avatar text;
begin
  if actor is null then raise exception 'Sign in before completing registration'; end if;
  if clean_name is null or length(clean_name)>120 then raise exception 'Enter your full name using up to 120 characters'; end if;
  if clean_username is null or clean_username !~ '^[a-z0-9_]{3,30}$' then raise exception 'Use 3-30 letters, numbers or underscores for your username'; end if;
  if p_role is null or p_role not in ('renter','owner') then raise exception 'Choose Student / Renter or Dorm Owner'; end if;
  if clean_phone is not null and clean_phone !~ '^\+?[0-9][0-9 ()-]{6,19}$' then raise exception 'Enter a valid contact number or leave it blank'; end if;
  if exists(select 1 from public.admins where admin_id=actor) then raise exception 'Administrator accounts use their existing profile'; end if;

  select * into saved from public.renters where renter_id=actor for update;
  if saved.renter_id is null then raise exception 'Your baseline profile is missing. Please sign in again'; end if;
  if saved.registration_completed_at is not null and saved.registration_role is distinct from p_role then
    raise exception 'This account already completed registration with a different role';
  end if;
  if p_role='renter' and exists(select 1 from public.owners where owner_id=actor) then
    raise exception 'This account already has an owner profile. Please continue as Dorm Owner';
  end if;
  select coalesce(raw_user_meta_data->>'avatar_url',raw_user_meta_data->>'picture') into google_avatar
  from auth.users where id=actor;
  -- The existing cross-role username trigger handles uniqueness atomically.
  update public.renters set full_name=clean_name,username=clean_username,phone_number=clean_phone,
    avatar_url=coalesce(nullif(avatar_url,''),google_avatar),registration_role=p_role,
    registration_completed_at=coalesce(registration_completed_at,now()),updated_at=now()
  where renter_id=actor;
  if p_role='owner' then
    insert into public.owners(owner_id,full_name,username,phone_number,avatar_url,updated_at)
    values(actor,clean_name,clean_username,clean_phone,google_avatar,now())
    on conflict(owner_id) do update set full_name=excluded.full_name,username=excluded.username,
      phone_number=excluded.phone_number,avatar_url=coalesce(nullif(public.owners.avatar_url,''),excluded.avatar_url),updated_at=now();
    -- No status/verification/admin privileges are accepted from the client.
  end if;
end $$;
revoke all on function public.complete_account_registration(text,text,text,text) from public,anon;
grant execute on function public.complete_account_registration(text,text,text,text) to authenticated;
notify pgrst,'reload schema';
