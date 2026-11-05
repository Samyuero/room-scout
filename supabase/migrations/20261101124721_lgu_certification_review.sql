create table public.lgu_certification_requests (
  certification_id uuid primary key default gen_random_uuid(),
  dorm_id uuid not null unique references public.dorms(dorm_id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  proof_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.lgu_certification_requests enable row level security;
revoke all on public.lgu_certification_requests from anon, authenticated;
grant select on public.lgu_certification_requests to authenticated;
create policy lgu_owner_admin_read on public.lgu_certification_requests for select to authenticated
using (owner_id = (select auth.uid()) or private.is_admin());

create or replace function public.submit_lgu_certification(p_dorm_id uuid,p_proof_path text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := (select auth.uid()); dorm_name text;
begin
  select name into dorm_name from public.dorms where dorm_id=p_dorm_id and owner_id=actor for update;
  if actor is null or dorm_name is null then raise exception 'Dorm not found or access denied'; end if;
  if p_proof_path not like actor::text || '/lgu-certification/%' or not exists (
    select 1 from storage.objects where bucket_id='private_documents' and name=p_proof_path
  ) then raise exception 'Upload a valid LGU certificate first'; end if;
  insert into public.lgu_certification_requests(dorm_id,owner_id,proof_path)
  values(p_dorm_id,actor,p_proof_path)
  on conflict(dorm_id) do update set proof_path=excluded.proof_path,status='pending',reviewed_by=null,updated_at=now();
  insert into public.notifications(user_id,title,message,type,related_dorm_id)
  select admin_id,'LGU certification review',dorm_name || ' has submitted certification proof.','lgu_certification',p_dorm_id from public.admins;
end; $$;
revoke all on function public.submit_lgu_certification(uuid,text) from public,anon;
grant execute on function public.submit_lgu_certification(uuid,text) to authenticated;

create or replace function public.review_lgu_certification(p_certification_id uuid,p_approved boolean)
returns void language plpgsql security definer set search_path='' as $$
declare item public.lgu_certification_requests%rowtype;
begin
  if not private.is_admin() then raise exception 'Administrator access required'; end if;
  select * into item from public.lgu_certification_requests where certification_id=p_certification_id for update;
  if item.certification_id is null or item.status <> 'pending' then raise exception 'Pending certification request not found'; end if;
  update public.lgu_certification_requests set status=case when p_approved then 'approved' else 'rejected' end,reviewed_by=(select auth.uid()),updated_at=now() where certification_id=p_certification_id;
  if p_approved then update public.dorms set lgu_certified=true,updated_at=now() where dorm_id=item.dorm_id; end if;
  insert into public.notifications(user_id,title,message,type,related_dorm_id)
  values(item.owner_id,'LGU certification updated',case when p_approved then 'Your LGU certification was approved.' else 'Your LGU proof was declined. Please review the document and submit a corrected certificate.' end,'lgu_certification',item.dorm_id);
end; $$;
revoke all on function public.review_lgu_certification(uuid,boolean) from public,anon;
grant execute on function public.review_lgu_certification(uuid,boolean) to authenticated;
create index lgu_certification_owner_idx on public.lgu_certification_requests(owner_id);
create index lgu_certification_reviewed_by_idx on public.lgu_certification_requests(reviewed_by);
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lgu_certification_requests') then
    alter publication supabase_realtime add table public.lgu_certification_requests;
  end if;
end $$;
notify pgrst,'reload schema';
