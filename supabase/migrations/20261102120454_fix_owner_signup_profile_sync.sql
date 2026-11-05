create or replace function private.ensure_renter_profile()
returns trigger language plpgsql security definer set search_path='' as $$
declare desired_username text := lower(nullif(trim(new.raw_user_meta_data->>'username'),''));
begin
  if desired_username is not null and exists(select 1 from public.renters where username=desired_username and renter_id<>new.id) then desired_username:=null; end if;
  insert into public.renters(renter_id,full_name,username,avatar_url,updated_at)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name'),desired_username,coalesce(new.raw_user_meta_data->>'avatar_url',new.raw_user_meta_data->>'picture'),now())
  on conflict(renter_id) do update set avatar_url=coalesce(nullif(public.renters.avatar_url,''),excluded.avatar_url),username=coalesce(public.renters.username,excluded.username);
  return new;
end $$;
revoke all on function private.ensure_renter_profile() from public,anon,authenticated;
update public.owners p set username=u.raw_user_meta_data->>'username' from auth.users u where p.owner_id=u.id and p.username is null and nullif(u.raw_user_meta_data->>'username','') is not null and not exists(select 1 from public.owners x where x.username=u.raw_user_meta_data->>'username' and x.owner_id<>p.owner_id);
notify pgrst,'reload schema';
