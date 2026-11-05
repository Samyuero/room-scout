-- Gemini quota protection is enforced server-side so a modified APK cannot bypass it.
create table if not exists public.ai_request_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_kind text not null check (window_kind in ('ten_minute', 'day')),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, window_kind, window_start)
);

alter table public.ai_request_rate_limits enable row level security;
revoke all on table public.ai_request_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_request_rate_limits to service_role;

create or replace function public.consume_ai_request_quota(
  p_user_id uuid,
  p_short_limit integer default 8,
  p_daily_limit integer default 40
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  remaining_short integer,
  remaining_daily integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_short_start timestamptz;
  v_day_start timestamptz;
  v_short_count integer := 0;
  v_daily_count integer := 0;
begin
  if p_user_id is null then
    raise exception 'A signed-in user is required';
  end if;
  if p_short_limit < 1 or p_daily_limit < p_short_limit then
    raise exception 'Invalid AI request limits';
  end if;

  v_short_start := date_trunc('hour', v_now)
    + floor(extract(minute from v_now) / 10) * interval '10 minutes';
  v_day_start := date_trunc('day', v_now);

  -- Serialize quota consumption per user so parallel requests cannot exceed a bucket.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  delete from public.ai_request_rate_limits
  where user_id = p_user_id
    and window_start < v_day_start - interval '2 days';

  select request_count into v_short_count
  from public.ai_request_rate_limits
  where user_id = p_user_id
    and window_kind = 'ten_minute'
    and window_start = v_short_start;
  v_short_count := coalesce(v_short_count, 0);

  select request_count into v_daily_count
  from public.ai_request_rate_limits
  where user_id = p_user_id
    and window_kind = 'day'
    and window_start = v_day_start;
  v_daily_count := coalesce(v_daily_count, 0);

  if v_short_count >= p_short_limit then
    return query select
      false,
      greatest(1, ceil(extract(epoch from (v_short_start + interval '10 minutes' - v_now)))::integer),
      0,
      greatest(0, p_daily_limit - v_daily_count);
    return;
  end if;

  if v_daily_count >= p_daily_limit then
    return query select
      false,
      greatest(1, ceil(extract(epoch from (v_day_start + interval '1 day' - v_now)))::integer),
      greatest(0, p_short_limit - v_short_count),
      0;
    return;
  end if;

  insert into public.ai_request_rate_limits (user_id, window_kind, window_start, request_count, updated_at)
  values (p_user_id, 'ten_minute', v_short_start, 1, v_now)
  on conflict (user_id, window_kind, window_start)
  do update set
    request_count = public.ai_request_rate_limits.request_count + 1,
    updated_at = excluded.updated_at;

  insert into public.ai_request_rate_limits (user_id, window_kind, window_start, request_count, updated_at)
  values (p_user_id, 'day', v_day_start, 1, v_now)
  on conflict (user_id, window_kind, window_start)
  do update set
    request_count = public.ai_request_rate_limits.request_count + 1,
    updated_at = excluded.updated_at;

  return query select
    true,
    0,
    greatest(0, p_short_limit - v_short_count - 1),
    greatest(0, p_daily_limit - v_daily_count - 1);
end;
$$;

revoke all on function public.consume_ai_request_quota(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_request_quota(uuid, integer, integer) to service_role;

comment on table public.ai_request_rate_limits is
  'Server-only fixed-window quota counters for the RoomScout AI Edge Function.';
