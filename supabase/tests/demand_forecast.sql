-- Read-only assertions rolled back; uses an existing active administrator, never creates credentials.
begin;
select set_config('request.jwt.claim.sub',(select admin_id::text from public.admins limit 1),true);
select set_config('roomscout.expected_published',(select count(*)::text from public.dorms where approval_status='approved'),true);
set local role authenticated;
do $$
declare context jsonb;
begin
  context := public.get_public_demand_context(array(select dorm_id from public.dorms limit 3));
  if jsonb_array_length(context->'portfolio'->'monthly_history') <> 12 then
    raise exception 'Expected 12 monthly history windows';
  end if;
  if (context->'portfolio'->>'listing_count')::integer <> current_setting('roomscout.expected_published')::integer then
    raise exception 'Pooled history must include all published listings, not only supplied IDs';
  end if;
  if context::text ~ 'user_id|renter_id|document|email|phone|proof' then
    raise exception 'Private field exposed in public aggregate context';
  end if;
  if has_function_privilege('anon','public.get_public_demand_context(uuid[])','EXECUTE') then
    raise exception 'Anonymous history access must be denied';
  end if;
  if (context->>'horizon_days')::integer <> 30 then raise exception 'Wrong forecast horizon'; end if;
end;
$$;
select 'PASS: all-listing aggregate history, 12 windows, active-auth access and no private fields' as result;
rollback;
