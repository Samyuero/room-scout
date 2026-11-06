-- Real role/RLS checks. Everything, including auth fixture users, is rolled back.
begin;
do $$
declare o uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); a uuid:=gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values
  (o,'authenticated','authenticated','owner-'||o||'@roomscout.invalid',now(),'{"provider":"email"}',jsonb_build_object('role','owner','full_name','Test owner','username','test_o_'||left(replace(o::text,'-',''),15)),now(),now()),
  (r,'authenticated','authenticated','renter-'||r||'@roomscout.invalid',now(),'{"provider":"email"}',jsonb_build_object('role','renter','full_name','Test renter','username','test_r_'||left(replace(r::text,'-',''),15)),now(),now()),
  (a,'authenticated','authenticated','admin-'||a||'@roomscout.invalid',now(),'{"provider":"email"}',jsonb_build_object('role','renter','full_name','Test admin','username','test_a_'||left(replace(a::text,'-',''),15)),now(),now());
  insert into public.admins(admin_id,full_name,username) select a,full_name,username from public.renters where renter_id=a;
  insert into storage.objects(bucket_id,name) values('private_documents',o||'/verifications/one.png'),('private_documents',o||'/verifications/two.png'),('private_documents',o||'/ownership-proof/one.png'),('private_documents',r||'/government-id/one.png');
  perform set_config('test.owner',o::text,true); perform set_config('test.renter',r::text,true); perform set_config('test.admin',a::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.owner'),true);
do $$
declare denied boolean:=false; id uuid;
begin
  begin insert into public.owner_verifications(user_id,document_url,status) values(auth.uid(),auth.uid()||'/verifications/one.png','approved'); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'FAIL: owner self-approved verification'; end if;
  denied:=false;
  begin insert into public.dorms(name,address,price,latitude,longitude,owner_id,ownership_proof_url,gender_policy) values('Unverified','Opao',1000,10.32644,123.95476,auth.uid(),auth.uid()||'/ownership-proof/one.png','co-ed'); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'FAIL: unverified owner published'; end if;
  id:=public.submit_owner_verification(auth.uid()||'/verifications/one.png');
  perform set_config('test.verification',id::text,true);
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
select public.review_owner_verification(current_setting('test.verification')::uuid,false,'Please replace the image.');
select set_config('request.jwt.claim.sub',current_setting('test.owner'),true);
select public.submit_owner_verification(auth.uid()||'/verifications/two.png');
do $$ begin
  if not exists(select 1 from public.owner_verifications where user_id=auth.uid() and status='pending' and reviewed_by is null and admin_notes is null and document_url like '%/two.png') then raise exception 'FAIL: rejected verification did not reset safely'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
select public.review_owner_verification(current_setting('test.verification')::uuid,true,null);
select set_config('request.jwt.claim.sub',current_setting('test.owner'),true);
do $$ declare id uuid; item public.dorms%rowtype; begin
  insert into public.dorms(name,address,price,latitude,longitude,owner_id,ownership_proof_url,approval_status,lgu_certified,is_featured,max_tenants,occupied_tenants,gender_policy)
  values('Instant listing fixture','Opao',4000,10.32644,123.95476,auth.uid(),auth.uid()||'/ownership-proof/one.png','pending',true,true,2,1,'co-ed')
  returning dorm_id into id;
  select * into item from public.dorms where dorm_id=id;
  if item.approval_status<>'approved' or item.lgu_certified or item.is_featured or item.occupied_tenants<>0 then raise exception 'FAIL: instant publication or protected fields'; end if;
  update public.dorms set occupied_tenants=2,is_featured=true,lgu_certified=true,created_at=now()+interval '1 day' where dorm_id=id;
  if exists(select 1 from public.dorms where dorm_id=id and (occupied_tenants<>0 or is_featured or lgu_certified)) then raise exception 'FAIL: owner tampered with moderation/capacity'; end if;
  if exists(select 1 from public.dorms where dorm_id=id and created_at>now()) then raise exception 'FAIL: owner changed the listing creation date'; end if;
  update public.dorms set available=false where dorm_id=id;
  if not exists(select 1 from public.dorms where dorm_id=id and availability_status='unavailable') then raise exception 'FAIL: closed listing status drifted'; end if;
  update public.dorms set available=true where dorm_id=id;
  if not exists(select 1 from public.dorms where dorm_id=id and availability_status='available') then raise exception 'FAIL: reopened listing status drifted'; end if;
  perform set_config('test.dorm',id::text,true);
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.renter'),true);
do $$ declare req uuid; ticket uuid; denied boolean:=false; begin
  insert into public.rental_requests(dorm_id,user_id,owner_id,renter_gov_id_url,payment_method)
  values(current_setting('test.dorm')::uuid,auth.uid(),current_setting('test.owner')::uuid,auth.uid()||'/government-id/one.png','cash') returning request_id into req;
  perform set_config('test.request',req::text,true);
  ticket:=public.create_support_ticket('Test support','A persistent support report',req);
  perform set_config('test.ticket',ticket::text,true);
  perform public.send_support_message(ticket,'Renter follow-up',false);
  begin perform public.send_support_message(ticket,'Forbidden private note',true); exception when others then denied:=true; end;
  if not denied then raise exception 'FAIL: renter added private admin note'; end if;
  denied:=false;
  begin perform public.admin_list_accounts(); exception when others then denied:=true; end;
  if not denied then raise exception 'FAIL: renter read account directory'; end if;
  if jsonb_array_length(public.get_public_demand_history(array[current_setting('test.dorm')::uuid],90))<>1 then raise exception 'FAIL: demand aggregate missing'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
select public.send_support_message(current_setting('test.ticket')::uuid,'Private administrator note',true);
select public.send_support_message(current_setting('test.ticket')::uuid,'Public support reply',false);
select public.admin_update_support_ticket(current_setting('test.ticket')::uuid,'in_progress',auth.uid());
select public.admin_review_renter_identity(current_setting('test.request')::uuid,true);
select set_config('request.jwt.claim.sub',current_setting('test.renter'),true);
do $$ begin
  if (select count(*) from public.support_messages where ticket_id=current_setting('test.ticket')::uuid)<>2 then raise exception 'FAIL: private admin note leaked'; end if;
  if not exists(select 1 from public.renter_verifications where user_id=auth.uid() and status='approved') then raise exception 'FAIL: identity review missing'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.owner'),true);
do $$ begin
  if exists(select 1 from public.support_tickets where ticket_id=current_setting('test.ticket')::uuid) then raise exception 'FAIL: another user ticket leaked'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
select public.admin_set_account_access(current_setting('test.renter')::uuid,'suspended','Rolled-back test');
select set_config('request.jwt.claim.sub',current_setting('test.renter'),true);
do $$ declare denied boolean:=false; begin
  if exists(select 1 from public.rental_requests where request_id=current_setting('test.request')::uuid) then raise exception 'FAIL: suspended account bypassed RLS'; end if;
  begin perform public.cancel_rental_request(current_setting('test.request')::uuid); exception when others then denied:=true; end;
  if not denied then raise exception 'FAIL: suspended account invoked privileged workflow'; end if;
end $$;
reset role;
select 'PASS: owner verification/resubmission, instant publication, capacity/moderation protection, private support, identity review, suspension/RLS' result;
rollback;
