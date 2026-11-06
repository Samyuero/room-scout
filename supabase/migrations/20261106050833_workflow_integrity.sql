-- Preserve server-owned capacity/moderation fields for crafted direct API calls too.
create or replace function private.protect_dorm_review_fields()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user not in ('authenticated','anon') or private.is_admin() then return new; end if;
  if tg_op='INSERT' then
    if split_part(coalesce(new.ownership_proof_url,''),'/',1)<>auth.uid()::text or not exists (
      select 1 from storage.objects where bucket_id='private_documents' and name=new.ownership_proof_url
    ) then raise exception 'Upload your ownership proof before publishing this listing'; end if;
    new.approval_status:='approved'; new.lgu_certified:=false; new.is_featured:=false;
    new.occupied_tenants:=0; new.status:='active';
  else
    new.owner_id:=old.owner_id; new.approval_status:=old.approval_status;
    new.lgu_certified:=old.lgu_certified; new.is_featured:=old.is_featured;
    new.occupied_tenants:=old.occupied_tenants; new.status:=old.status;
    if new.max_tenants<old.occupied_tenants then raise exception 'Capacity cannot be lower than the occupied tenant slots'; end if;
  end if;
  if new.max_tenants not between 1 and 500 then raise exception 'Maximum tenants must be between 1 and 500'; end if;
  if new.occupied_tenants>=new.max_tenants then new.available:=false; end if;
  return new;
end;
$$;

-- Queues refresh without first opening their tabs.
do $$ declare item text; begin
  foreach item in array array['owner_verifications','account_access','renter_verifications','rental_extensions'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=item) then
      execute format('alter publication supabase_realtime add table public.%I',item);
    end if;
  end loop;
end $$;
create or replace function private.notify_renter_identity_reviewed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(user_id,title,message,type,related_request_id)
    values(new.user_id,'Identity review updated','Your submitted renter ID was '||new.status||'.','renter_identity_review',new.request_id);
  return new;
end;
$$;
revoke all on function private.notify_renter_identity_reviewed() from public,anon,authenticated;
create trigger notify_renter_identity_reviewed after insert or update on public.renter_verifications
for each row execute function private.notify_renter_identity_reviewed();

create index if not exists owner_verifications_reviewed_by_idx on public.owner_verifications(reviewed_by);
create index if not exists account_access_updated_by_idx on public.account_access(updated_by);
create index if not exists notifications_verification_idx on public.notifications(related_verification_id) where related_verification_id is not null;
create index if not exists notifications_certification_idx on public.notifications(related_certification_id) where related_certification_id is not null;
create index if not exists support_tickets_related_request_idx on public.support_tickets(related_request_id) where related_request_id is not null;
create index if not exists rental_extensions_owner_idx on public.rental_extensions(owner_id);
notify pgrst,'reload schema';
