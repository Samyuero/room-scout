-- RoomScout runtime compatibility update
-- Run once in the Supabase SQL editor for projects that already use schema_v2.sql.
-- Safe to run again: every schema addition and policy is idempotent.

begin;

alter table public.rental_requests
  add column if not exists request_type text not null default 'rental',
  add column if not exists required_amount numeric(10,2),
  add column if not exists owner_payment_qr_url text,
  add column if not exists contract_url text,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payment_verified_by uuid,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists renter_refund_qr_url text,
  add column if not exists cancel_reason text,
  add column if not exists refund_proof_url text,
  add column if not exists refund_sent_at timestamptz;

alter table public.rental_requests drop constraint if exists rental_requests_request_type_check;
alter table public.rental_requests add constraint rental_requests_request_type_check
  check (request_type in ('rental', 'reservation')) not valid;
alter table public.rental_requests validate constraint rental_requests_request_type_check;

alter table public.dorms
  add column if not exists approval_status text not null default 'pending',
  add column if not exists availability_status text not null default 'available',
  add column if not exists ownership_proof_url text,
  add column if not exists house_rules text[] not null default '{}',
  add column if not exists room_type text,
  add column if not exists furnished boolean not null default false,
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists owner_display_name text,
  add column if not exists max_tenants integer not null default 1,
  add column if not exists occupied_tenants integer not null default 0,
  add column if not exists reservation_fee numeric(10,2) not null default 0;

alter table public.dorm_reviews
  add column if not exists photos text[] not null default '{}';

alter table public.dorm_reviews enable row level security;
drop policy if exists "Users can insert their own dorm review" on public.dorm_reviews;
drop policy if exists "roomscout_reviewers_insert_own" on public.dorm_reviews;
create policy "roomscout_reviewers_insert_own" on public.dorm_reviews for insert to authenticated
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.dorm_reviews to authenticated;
grant select on public.dorm_reviews to anon;
grant select, insert, update on public.renters to authenticated;

-- Return only fields that are safe to show on public review cards. Reviewer user IDs
-- and renter preferences are intentionally excluded.
create or replace function public.get_public_dorm_reviews(p_dorm_id uuid)
returns table (
  review_id uuid,
  rating integer,
  comment text,
  photos text[],
  created_at timestamptz,
  reviewer_name text,
  reviewer_avatar_url text,
  verified_renter boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    review.review_id,
    review.rating,
    review.comment,
    review.photos,
    review.created_at,
    coalesce(
      case when nullif(trim(renter.username), '') is not null then '@' || trim(renter.username) end,
      nullif(trim(renter.full_name), ''),
      'Renter'
    ),
    renter.avatar_url,
    exists (
      select 1 from public.rentals rental
      where rental.dorm_id = review.dorm_id
        and rental.user_id = review.user_id
        and rental.status in ('active', 'past')
    )
  from public.dorm_reviews review
  left join public.renters renter on renter.renter_id = review.user_id
  where review.dorm_id = p_dorm_id
  order by review.created_at desc;
$$;
revoke all on function public.get_public_dorm_reviews(uuid) from public;
grant execute on function public.get_public_dorm_reviews(uuid) to anon, authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('uploaded_images', 'uploaded_images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public_read_listing_images" on storage.objects;
drop policy if exists "users_upload_own_listing_images" on storage.objects;
drop policy if exists "users_update_own_listing_images" on storage.objects;
drop policy if exists "users_delete_own_listing_images" on storage.objects;
create policy "public_read_listing_images" on storage.objects for select to anon, authenticated
  using (bucket_id = 'uploaded_images');
create policy "users_upload_own_listing_images" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploaded_images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "users_update_own_listing_images" on storage.objects for update to authenticated
  using (bucket_id = 'uploaded_images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'uploaded_images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "users_delete_own_listing_images" on storage.objects for delete to authenticated
  using (bucket_id = 'uploaded_images' and (storage.foldername(name))[1] = (select auth.uid())::text);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('private_documents', 'private_documents', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users_upload_own_private_documents" on storage.objects;
drop policy if exists "users_read_own_private_documents" on storage.objects;
drop policy if exists "admins_read_private_documents" on storage.objects;
drop policy if exists "request_participants_read_private_documents" on storage.objects;
create policy "users_upload_own_private_documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'private_documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "users_read_own_private_documents" on storage.objects for select to authenticated
  using (bucket_id = 'private_documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "admins_read_private_documents" on storage.objects for select to authenticated
  using (
    bucket_id = 'private_documents'
    and exists (select 1 from public.admins where admin_id = (select auth.uid()))
  );
create policy "request_participants_read_private_documents" on storage.objects for select to authenticated
  using (
    bucket_id = 'private_documents' and exists (
      select 1 from public.rental_requests request
      where (request.owner_id = (select auth.uid()) or request.user_id = (select auth.uid()))
        and (
          request.renter_gov_id_url = storage.objects.name
          or request.payment_proof_url = storage.objects.name
          or request.owner_payment_qr_url = storage.objects.name
          or request.contract_url = storage.objects.name
          or request.renter_refund_qr_url = storage.objects.name
          or request.refund_proof_url = storage.objects.name
        )
    )
  );

create index if not exists rental_requests_owner_status_idx
  on public.rental_requests(owner_id, status, updated_at desc);
create index if not exists rental_requests_user_status_idx
  on public.rental_requests(user_id, status, updated_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, read, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rental_requests'
  ) then
    alter publication supabase_realtime add table public.rental_requests;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dorms'
  ) then
    alter publication supabase_realtime add table public.dorms;
  end if;
end $$;

commit;

-- Refresh PostgREST immediately so request_type and the other columns are visible.
notify pgrst, 'reload schema';
