-- Aggregate-only forecasting context. No identities, documents, messages, or raw requests leave SQL.
-- Archived published listings remain in the pooled history, so taking a listing offline does not erase history.
create or replace function private.demand_forecast_context(p_dorm_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if (select auth.uid()) is null or not private.account_is_active() then
    raise exception 'Sign in with an active account to view demand forecasts.' using errcode = '42501';
  end if;
  with published as materialized (
    select d.dorm_id,d.created_at from public.dorms d where d.approval_status='approved'
  ), inquiries as materialized (
    select r.dorm_id,r.created_at as event_at from public.rental_requests r
    join published d on d.dorm_id=r.dorm_id
  ), bookings as materialized (
    select r.dorm_id,r.payment_verified_at as event_at from public.rental_requests r
    join published d on d.dorm_id=r.dorm_id where r.payment_verified_at is not null
    union all
    -- A manually added tenant has no originating request; do not count linked rentals twice.
    select r.dorm_id,r.created_at from public.rentals r
    join published d on d.dorm_id=r.dorm_id where r.request_id is null
  ), months as (
    select generate_series(date_trunc('month',now())-interval '11 months',date_trunc('month',now()),interval '1 month') as month
  ), monthly as (
    select to_char(m.month,'YYYY-MM') as month,
      (select count(*) from inquiries i where i.event_at>=m.month and i.event_at<m.month+interval '1 month') as inquiries,
      (select count(*) from bookings b where b.event_at>=m.month and b.event_at<m.month+interval '1 month') as bookings
    from months m order by m.month
  )
  select jsonb_build_object(
    'generated_at',now(),'horizon_days',30,
    'listings',public.get_public_demand_history(p_dorm_ids,365),
    'portfolio',jsonb_build_object(
      'listing_count',(select count(*) from published),
      'observed_days',(select greatest(0,coalesce(floor(extract(epoch from (now()-min(created_at)))/86400),0)) from published),
      'inquiries_all_time',(select count(*) from inquiries),
      'bookings_all_time',(select count(*) from bookings),
      'inquiries_30d',(select count(*) from inquiries where event_at>=now()-interval '30 days'),
      'prior_inquiries_30d',(select count(*) from inquiries where event_at>=now()-interval '60 days' and event_at<now()-interval '30 days'),
      'bookings_30d',(select count(*) from bookings where event_at>=now()-interval '30 days'),
      'prior_bookings_30d',(select count(*) from bookings where event_at>=now()-interval '60 days' and event_at<now()-interval '30 days'),
      'monthly_history',(select coalesce(jsonb_agg(to_jsonb(monthly)),'[]'::jsonb) from monthly)
    )
  ) into result;
  return result;
end;
$$;
revoke all on function private.demand_forecast_context(uuid[]) from public,anon,authenticated,service_role;

-- SECURITY INVOKER API entry point; the private helper performs the aggregate-only privileged read.
create or replace function public.get_public_demand_context(p_dorm_ids uuid[])
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.demand_forecast_context(p_dorm_ids[1:100]);
$$;
grant usage on schema private to authenticated;
grant execute on function private.demand_forecast_context(uuid[]) to authenticated;
revoke all on function public.get_public_demand_context(uuid[]) from public,anon;
grant execute on function public.get_public_demand_context(uuid[]) to authenticated;
comment on function public.get_public_demand_context(uuid[]) is
  'Signed-in aggregate-only history across all published dorms, 12 monthly windows and selected public listing summaries. No individual renter data.';
notify pgrst,'reload schema';
