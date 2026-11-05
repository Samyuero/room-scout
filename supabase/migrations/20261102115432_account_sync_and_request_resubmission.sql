create or replace function private.ensure_renter_profile()
returns trigger language plpgsql security definer set search_path='' as $$
declare desired_username text := lower(nullif(trim(new.raw_user_meta_data->>'username'),''));
begin
  if desired_username is not null and exists(select 1 from public.renters where username=desired_username and renter_id<>new.id) then desired_username:=null; end if;
  insert into public.renters(renter_id,full_name,username,avatar_url,updated_at)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name'),desired_username,coalesce(new.raw_user_meta_data->>'avatar_url',new.raw_user_meta_data->>'picture'),now())
  on conflict(renter_id) do update set avatar_url=coalesce(nullif(public.renters.avatar_url,''),excluded.avatar_url),username=coalesce(public.renters.username,excluded.username);
  if new.raw_user_meta_data->>'role'='owner' then
    insert into public.owners(owner_id,full_name,avatar_url,updated_at)
    values(new.id,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name'),coalesce(new.raw_user_meta_data->>'avatar_url',new.raw_user_meta_data->>'picture'),now())
    on conflict(owner_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.ensure_renter_profile() from public,anon,authenticated;
update public.renters r set username=p.username from public.owners p where r.renter_id=p.owner_id and r.username is null and p.username is not null and not exists(select 1 from public.renters x where x.username=p.username and x.renter_id<>r.renter_id);
update public.renters r set username=p.username from public.admins p where r.renter_id=p.admin_id and r.username is null and p.username is not null and not exists(select 1 from public.renters x where x.username=p.username and x.renter_id<>r.renter_id);
insert into public.owners(owner_id,full_name,avatar_url,updated_at)
select id,coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name'),coalesce(raw_user_meta_data->>'avatar_url',raw_user_meta_data->>'picture'),now() from auth.users where raw_user_meta_data->>'role'='owner'
on conflict(owner_id) do nothing;

create or replace function private.notify_request_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare dorm_name text;
begin
select name into dorm_name from public.dorms where dorm_id=new.dorm_id;
if tg_op='INSERT' then
 insert into public.notifications(user_id,title,message,type,related_dorm_id,related_request_id) values(new.owner_id,'New dorm request','A renter submitted a request for '||dorm_name||'.','rental_request',new.dorm_id,new.request_id);
elsif new.status is distinct from old.status then
 if new.status in ('awaiting_payment','awaiting_cash','rejected','approved','reserved','refund_sent','refund_completed') then
  insert into public.notifications(user_id,title,message,type,related_dorm_id,related_request_id) values(new.user_id,'Request updated',dorm_name||' is now at step: '||replace(new.status,'_',' ')||'.',new.status,new.dorm_id,new.request_id);
 elsif new.status in ('payment_submitted','refund_requested','cancelled') then
  insert into public.notifications(user_id,title,message,type,related_dorm_id,related_request_id) values(new.owner_id,'Request action needed',dorm_name||' is now at step: '||replace(new.status,'_',' ')||'.',new.status,new.dorm_id,new.request_id);
 end if;
end if;
return new;
end $$;
revoke all on function private.notify_request_change() from public,anon,authenticated;
notify pgrst,'reload schema';
