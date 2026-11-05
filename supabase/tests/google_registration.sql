-- All synthetic accounts and profile changes roll back.
begin;
set local plpgsql.check_asserts = on;
do $$
declare
  google_owner uuid := gen_random_uuid(); google_renter uuid := gen_random_uuid();
  manual_owner uuid := gen_random_uuid(); manual_renter uuid := gen_random_uuid();
  blocked boolean; unique_name text := 'reg_'||replace(gen_random_uuid()::text,'-','');
begin
  unique_name := left(unique_name,25);
  insert into auth.users(id,raw_app_meta_data,raw_user_meta_data) values
    (google_owner,'{"provider":"google"}','{"name":"Google fixture owner","picture":"https://example.invalid/avatar.jpg"}'),
    (google_renter,'{"provider":"google"}','{"name":"Google fixture renter"}'),
    (manual_owner,'{"provider":"email"}',jsonb_build_object('role','owner','full_name','Manual fixture owner','username',unique_name||'_mo')),
    (manual_renter,'{"provider":"email"}',jsonb_build_object('role','renter','full_name','Manual fixture renter','username',unique_name||'_mr'));
  assert (select registration_completed_at is null and registration_role is null from public.renters where renter_id=google_owner), 'Google account silently completed as renter';
  assert not exists(select 1 from public.owners where owner_id=google_owner), 'Google auth silently created owner';
  assert (select registration_role='owner' and registration_completed_at is not null from public.renters where renter_id=manual_owner), 'Manual owner signup regressed';
  assert (select registration_role='renter' and registration_completed_at is not null from public.renters where renter_id=manual_renter), 'Manual renter signup regressed';
  perform set_config('request.jwt.claim.sub',google_owner::text,true);
  perform public.complete_account_registration('Chosen owner name',unique_name||'_go','owner','0917 123 4567');
  assert (select registration_role='owner' and registration_completed_at is not null and phone_number='0917 123 4567' from public.renters where renter_id=google_owner), 'Owner completion missing baseline values';
  assert (select username=unique_name||'_go' and full_name='Chosen owner name' and phone_number='0917 123 4567' and status<>'verified' from public.owners where owner_id=google_owner), 'Owner profile values or verification state wrong';
  assert (select avatar_url='https://example.invalid/avatar.jpg' from public.owners where owner_id=google_owner), 'Google avatar missing';
  perform public.complete_account_registration('Chosen owner name',unique_name||'_go','owner','0917 123 4567');
  blocked := false;
  begin perform public.complete_account_registration('Changed role',unique_name||'_go','renter',null); exception when others then blocked := true; end;
  assert blocked, 'Completed role silently changed';
  perform set_config('request.jwt.claim.sub',google_renter::text,true);
  blocked := false;
  begin perform public.complete_account_registration('Duplicate',unique_name||'_go','renter',null); exception when unique_violation then blocked := true; end;
  assert blocked, 'Cross-role duplicate username accepted';
  assert (select registration_completed_at is null from public.renters where renter_id=google_renter), 'Failed save marked registration complete';
  blocked := false;
  begin perform public.complete_account_registration('Invalid role',unique_name||'_gr','admin',null); exception when others then blocked := true; end;
  assert blocked, 'Self-admin registration accepted';
  blocked := false;
  begin perform public.complete_account_registration('Invalid phone',unique_name||'_gr','renter','mp3'); exception when others then blocked := true; end;
  assert blocked, 'Invalid phone accepted';
  perform public.complete_account_registration('Chosen renter name',unique_name||'_gr','renter',null);
  assert (select registration_role='renter' and registration_completed_at is not null and phone_number is null from public.renters where renter_id=google_renter), 'Renter completion or optional phone failed';
  assert not exists(select 1 from public.owners where owner_id=google_renter), 'Renter unexpectedly became owner';
  perform set_config('roomscout.test.registration_user',google_renter::text,true);
  perform set_config('roomscout.test.other_registration_user',google_owner::text,true);
end $$;
set local role authenticated;
do $$
declare blocked boolean; actor uuid := current_setting('roomscout.test.registration_user')::uuid;
begin
  perform set_config('request.jwt.claim.sub',actor::text,true);
  blocked := false;
  begin update public.renters set registration_role='owner' where renter_id=actor;
  exception when others then blocked := true; end;
  assert blocked, 'Client bypassed registration action';
  perform public.complete_account_registration('Authenticated renter',
    (select username from public.renters where renter_id=actor),'renter',null);
  assert (select full_name='Authenticated renter' and registration_completed_at is not null from public.renters where renter_id=actor), 'Authenticated completion RPC failed';
  assert not exists(select 1 from public.renters where renter_id=current_setting('roomscout.test.other_registration_user')::uuid), 'Registration leaked another profile';
  assert not has_function_privilege('anon','public.complete_account_registration(text,text,text,text)','execute'), 'Anonymous registration completion allowed';
end $$;
reset role;
rollback;
select 'PASS: Google role/details/phone/avatar, manual signup, uniqueness, retry and authenticated privacy assertions; fixtures rolled back' as result;
