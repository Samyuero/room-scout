-- Keep public status and creation metadata consistent with capacity edits.
create or replace function private.protect_dorm_client_metadata()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user not in ('authenticated','anon') then return new; end if;
  if tg_op='INSERT' then
    new.created_at:=now();
    new.availability_status:=case when new.available then 'available' else 'unavailable' end;
  else
    new.dorm_id:=old.dorm_id; new.created_at:=old.created_at;
    new.availability_status:=old.availability_status;
    if new.available is distinct from old.available or new.max_tenants is distinct from old.max_tenants then
      if old.occupied_tenants>=new.max_tenants then
        new.available:=false;
        new.availability_status:=case when old.availability_status='reserved' then 'reserved' else 'unavailable' end;
      else
        new.availability_status:=case when new.available then 'available' else 'unavailable' end;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.protect_dorm_client_metadata() from public,anon,authenticated;
create trigger protect_dorm_client_metadata before insert or update on public.dorms
for each row execute function private.protect_dorm_client_metadata();
notify pgrst,'reload schema';
