-- Reject self-rental even if an old client displays stale renter controls.
alter table public.rental_requests drop constraint if exists rental_requests_no_self_rental;
alter table public.rental_requests add constraint rental_requests_no_self_rental
  check (user_id <> owner_id);
drop policy if exists renters_insert_pending_requests on public.rental_requests;
create policy renters_insert_pending_requests on public.rental_requests
for insert to authenticated with check (
  user_id = (select auth.uid()) and owner_id <> (select auth.uid()) and status = 'pending'
  and owner_id = (select d.owner_id from public.dorms d where d.dorm_id = rental_requests.dorm_id)
);

-- Empty listing contacts are valid; supplied contacts use the profile format.
alter table public.dorms drop constraint if exists dorms_contact_phone_check;
alter table public.dorms add constraint dorms_contact_phone_check check (
  nullif(btrim(contact_phone), '') is null or contact_phone ~ '^[+]?[0-9][0-9 ()-]{6,19}$'
) not valid;

create index if not exists renters_username_lookup on public.renters (lower(btrim(username))) where username is not null;
create index if not exists owners_username_lookup on public.owners (lower(btrim(username))) where username is not null;
create index if not exists admins_username_lookup on public.admins (lower(btrim(username))) where username is not null;

-- One name may occur in multiple role profiles only for the SAME auth account.
-- The transaction lock closes races between inserts into different role tables.
create or replace function private.enforce_unique_profile_username()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  clean text := lower(nullif(btrim(new.username), ''));
  account_id uuid;
begin
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then return new; end if;
  new.username := clean;
  if clean is null then return new; end if;
  if clean !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'Username must contain 3-30 letters, numbers or underscores' using errcode = '23514';
  end if;
  account_id := case tg_table_name when 'renters' then (to_jsonb(new)->>'renter_id')::uuid
    when 'owners' then (to_jsonb(new)->>'owner_id')::uuid else (to_jsonb(new)->>'admin_id')::uuid end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(clean, 4791));
  if exists (
    select 1 from public.renters where lower(btrim(username)) = clean and renter_id <> account_id
    union all select 1 from public.owners where lower(btrim(username)) = clean and owner_id <> account_id
    union all select 1 from public.admins where lower(btrim(username)) = clean and admin_id <> account_id
  ) then raise exception 'That username is already taken' using errcode = '23505'; end if;
  return new;
end $$;
revoke all on function private.enforce_unique_profile_username() from public, anon, authenticated;
drop trigger if exists enforce_unique_username on public.renters;
drop trigger if exists enforce_unique_username on public.owners;
drop trigger if exists enforce_unique_username on public.admins;
create trigger enforce_unique_username before insert or update of username on public.renters
for each row execute function private.enforce_unique_profile_username();
create trigger enforce_unique_username before insert or update of username on public.owners
for each row execute function private.enforce_unique_profile_username();
create trigger enforce_unique_username before insert or update of username on public.admins
for each row execute function private.enforce_unique_profile_username();

-- Intentionally public for signup. Returns only availability, never profile data.
create or replace function public.is_username_available(p_username text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when lower(btrim(p_username)) ~ '^[a-z0-9_]{3,30}$' then not exists (
    select 1 from public.renters where lower(btrim(username)) = lower(btrim(p_username)) and renter_id is distinct from (select auth.uid())
    union all select 1 from public.owners where lower(btrim(username)) = lower(btrim(p_username)) and owner_id is distinct from (select auth.uid())
    union all select 1 from public.admins where lower(btrim(username)) = lower(btrim(p_username)) and admin_id is distinct from (select auth.uid())
  ) else false end;
$$;
revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

-- Contact metadata is profile information, not a verified Auth phone/OTP identity.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  requested_role text := coalesce(new.raw_user_meta_data->>'role', 'renter');
  safe_username text := lower(nullif(btrim(new.raw_user_meta_data->>'username'), ''));
  safe_name text := nullif(btrim(new.raw_user_meta_data->>'full_name'), '');
  contact text := nullif(btrim(new.raw_user_meta_data->>'contact_phone'), '');
begin
  if requested_role = 'owner' then
    insert into public.owners(owner_id, username, full_name, phone_number, updated_at)
    values(new.id, safe_username, safe_name, contact, now()) on conflict(owner_id) do nothing;
  else
    insert into public.renters(renter_id, username, full_name, phone_number, updated_at)
    values(new.id, safe_username, safe_name, contact, now()) on conflict(renter_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function private.ensure_renter_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare desired_username text := lower(nullif(btrim(new.raw_user_meta_data->>'username'), ''));
begin
  insert into public.renters(renter_id, full_name, username, avatar_url, phone_number, updated_at)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), desired_username,
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'), nullif(btrim(new.raw_user_meta_data->>'contact_phone'), ''), now())
  on conflict(renter_id) do update set
    avatar_url = coalesce(nullif(public.renters.avatar_url, ''), excluded.avatar_url),
    username = coalesce(public.renters.username, excluded.username),
    phone_number = coalesce(public.renters.phone_number, excluded.phone_number);
  return new;
end $$;
revoke all on function private.ensure_renter_profile() from public, anon, authenticated;
notify pgrst, 'reload schema';
