begin;

-- Legacy trigger helpers must only run through their triggers. They are not RPCs.
alter function public.handle_rental_request_update() set search_path = '';
alter function public.handle_rental_request_deletion() set search_path = '';
alter function public.handle_rentals_sync() set search_path = '';
revoke all on function public.handle_rental_request_update() from public, anon, authenticated;
revoke all on function public.handle_rental_request_deletion() from public, anon, authenticated;
revoke all on function public.handle_rentals_sync() from public, anon, authenticated;

-- The old dorm-id cancellation RPC could change availability too broadly.
-- The app now calls cancel_active_rental(request_id), which verifies ownership and status.
alter function public.cancel_rental(uuid) set search_path = '';
revoke all on function public.cancel_rental(uuid) from public, anon, authenticated;

-- This event-trigger helper is internal database infrastructure, not a client RPC.
alter function public.rls_auto_enable() set search_path = pg_catalog;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

-- Keep owner notifications database-generated because clients cannot insert them.
create or replace function private.notify_request_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare dorm_name text;
begin
  select name into dorm_name from public.dorms where dorm_id = new.dorm_id;
  if tg_op = 'INSERT' then
    insert into public.notifications(user_id, title, message, type, related_dorm_id, related_request_id)
    values (new.owner_id, 'New dorm request', 'A renter submitted a request for ' || dorm_name || '.', 'rental_request', new.dorm_id, new.request_id);
  elsif new.status is distinct from old.status then
    if new.status in ('awaiting_payment', 'rejected', 'approved', 'reserved', 'refund_sent', 'refund_completed') then
      insert into public.notifications(user_id, title, message, type, related_dorm_id, related_request_id)
      values (new.user_id, 'Request updated', dorm_name || ' is now at step: ' || replace(new.status, '_', ' ') || '.', new.status, new.dorm_id, new.request_id);
    elsif new.status in ('payment_submitted', 'refund_requested', 'cancelled') then
      insert into public.notifications(user_id, title, message, type, related_dorm_id, related_request_id)
      values (new.owner_id, 'Request action needed', dorm_name || ' is now at step: ' || replace(new.status, '_', ' ') || '.', new.status, new.dorm_id, new.request_id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.notify_request_change() from public, anon, authenticated;

commit;
