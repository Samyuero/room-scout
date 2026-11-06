-- Run only after rental_completion.sql and account_access are applied.
-- Every fixture, notification, object metadata row and audit entry is rolled back.
begin;
do $$
declare
  owner_uid uuid:=gen_random_uuid(); renter_uid uuid:=gen_random_uuid(); other_uid uuid:=gen_random_uuid();
  dorm_uid uuid:=gen_random_uuid(); req uuid; over_capacity_req uuid; tenancy uuid; reserve_req uuid; cancelled_req uuid;
  qr_path text; receipt_path text; rejected boolean; occupied integer; state text; amount numeric; history jsonb;
begin
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values
   (owner_uid,'authenticated','authenticated','rental-owner-'||owner_uid||'@roomscout.invalid',now(),'{"provider":"email"}',jsonb_build_object('role','owner','full_name','Workflow test owner','username','test_o_'||left(replace(owner_uid::text,'-',''),16)),now(),now()),
   (renter_uid,'authenticated','authenticated','rental-user-'||renter_uid||'@roomscout.invalid',now(),'{"provider":"email"}',jsonb_build_object('role','renter','full_name','Workflow test renter','username','test_r_'||left(replace(renter_uid::text,'-',''),16)),now(),now()),
   (other_uid,'authenticated','authenticated','rental-other-'||other_uid||'@roomscout.invalid',now(),'{"provider":"email"}',jsonb_build_object('role','renter','full_name','Other workflow renter','username','test_x_'||left(replace(other_uid::text,'-',''),16)),now(),now());
  insert into public.dorms(dorm_id,name,address,price,latitude,longitude,gender_policy,owner_id,max_tenants,reservation_fee,approval_status,status)
  values(dorm_uid,'ROLLED BACK workflow fixture','Opao test location',6000,10.3291,123.9558,'co-ed',owner_uid,1,1000,'approved','active');

  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  insert into public.rental_requests(dorm_id,user_id,owner_id,request_type,payment_method) values(dorm_uid,renter_uid,owner_uid,'rental','cash') returning request_id into req;
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  perform public.owner_accept_cash_request(req);
  perform public.owner_confirm_cash_payment(req);
  select occupied_tenants into occupied from public.dorms where dorm_id=dorm_uid;
  if occupied<>1 then raise exception 'Cash confirmation failed to allocate one bed'; end if;
  select rental_id into tenancy from public.rentals where request_id=req and status='active';
  if tenancy is null then raise exception 'Cash rental is not linked to its request'; end if;
  rejected:=false;
  begin perform public.owner_confirm_cash_payment(req); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Duplicate confirmation was accepted'; end if;
  perform public.owner_extend_rental(tenancy,now()+interval '2 months');
  if (select count(*) from public.rental_extensions where rental_id=tenancy)<>1 then raise exception 'Stay extension was not recorded'; end if;

  perform set_config('request.jwt.claim.sub',other_uid::text,true);
  history:=public.get_renter_booking_history();
  if jsonb_array_length(history)<>0 then raise exception 'Another renter booking was leaked'; end if;
  rejected:=false;
  begin perform public.owner_end_rental(tenancy); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Other renter ended an owner tenancy'; end if;
  insert into public.rental_requests(dorm_id,user_id,owner_id,request_type,payment_method) values(dorm_uid,other_uid,owner_uid,'rental','cash') returning request_id into over_capacity_req;
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  perform public.owner_accept_cash_request(over_capacity_req);
  rejected:=false;
  begin perform public.owner_confirm_cash_payment(over_capacity_req); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Capacity was exceeded'; end if;
  perform public.owner_end_rental(tenancy);
  if (select status from public.rental_requests where request_id=req)<>'completed' then raise exception 'Ended tenancy left a stale approved request'; end if;
  if (select jsonb_array_length(public.get_owner_tenant_history(dorm_uid)))<>1 then raise exception 'Past tenant history missing'; end if;
  perform set_config('request.jwt.claim.sub',other_uid::text,true);
  perform public.cancel_rental_request(over_capacity_req);

  -- QR reservation -> tenancy must reuse the reserved bed.
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  insert into public.rental_requests(dorm_id,user_id,owner_id,request_type,payment_method) values(dorm_uid,renter_uid,owner_uid,'reservation','qr') returning request_id into reserve_req;
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  update public.rental_requests set status='awaiting_payment',required_amount=1000,owner_payment_qr_url=owner_uid||'/qrcodes/test.png',contract_url=owner_uid||'/contracts/test.png' where request_id=reserve_req;
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  update public.rental_requests set status='payment_submitted',payment_status='pending_verification',contract_agreed=true,payment_proof_url=renter_uid||'/payment-proof/test.png' where request_id=reserve_req;
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  perform public.owner_confirm_qr_payment(reserve_req,true);
  if (select status from public.rental_requests where request_id=reserve_req)<>'reserved' then raise exception 'Paid reservation disappeared'; end if;
  perform public.convert_reservation_to_rental(reserve_req);
  if (select occupied_tenants from public.dorms where dorm_id=dorm_uid)<>1 then raise exception 'Reservation conversion double-counted occupancy'; end if;
  if not exists(select 1 from public.rentals where request_id=reserve_req and status='active') then raise exception 'Converted reservation missing from tenants'; end if;

  -- Refund: hold capacity until the renter confirms, then release exactly once.
  qr_path:=renter_uid||'/refund-qr/test.png'; receipt_path:=owner_uid||'/refund-proof/test.png';
  insert into storage.objects(bucket_id,name) values('private_documents',qr_path),('private_documents',receipt_path);
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  perform public.request_booking_refund(reserve_req,qr_path,'Test GCash','09123456789','Workflow test');
  select refund_amount into amount from public.rental_requests where request_id=reserve_req;
  if amount<>900 or (select refund_deduction from public.rental_requests where request_id=reserve_req)<>100 then raise exception '90/10 refund arithmetic is wrong'; end if;
  if (select occupied_tenants from public.dorms where dorm_id=dorm_uid)<>1 then raise exception 'Refund request prematurely released capacity'; end if;
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  perform public.owner_submit_refund(reserve_req,receipt_path);
  if (select occupied_tenants from public.dorms where dorm_id=dorm_uid)<>1 then raise exception 'Owner proof prematurely released capacity'; end if;
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  perform public.confirm_booking_refund(reserve_req);
  perform public.confirm_booking_refund(reserve_req);
  if (select occupied_tenants from public.dorms where dorm_id=dorm_uid)<>0 then raise exception 'Refund confirmation did not release exactly once'; end if;
  if exists(select 1 from public.rentals where request_id=reserve_req and status='active') then raise exception 'Refunded tenancy still active'; end if;

  -- Cancelling an uploaded but unconfirmed receipt must never allocate a bed.
  insert into public.rental_requests(dorm_id,user_id,owner_id,request_type,payment_method) values(dorm_uid,renter_uid,owner_uid,'rental','qr') returning request_id into cancelled_req;
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  update public.rental_requests set status='awaiting_payment',required_amount=6000,owner_payment_qr_url=owner_uid||'/qrcodes/test.png',contract_url=owner_uid||'/contracts/test.png' where request_id=cancelled_req;
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  update public.rental_requests set status='payment_submitted',payment_status='pending_verification',contract_agreed=true,payment_proof_url=renter_uid||'/payment-proof/test.png' where request_id=cancelled_req;
  perform public.cancel_rental_request(cancelled_req);
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  perform public.owner_confirm_qr_payment(cancelled_req,true);
  select status into state from public.rental_requests where request_id=cancelled_req;
  if state<>'cancelled' or (select occupied_tenants from public.dorms where dorm_id=dorm_uid)<>0 then raise exception 'Cancelled receipt review reopened the booking'; end if;
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  perform public.request_booking_refund(cancelled_req,qr_path,'Test GCash','09123456789','Cancelled receipt');
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  perform public.owner_submit_refund(cancelled_req,receipt_path);
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  perform public.confirm_booking_refund(cancelled_req);
  if (select occupied_tenants from public.dorms where dorm_id=dorm_uid)<>0 then raise exception 'Refund of an unallocated booking decremented capacity'; end if;
  raise notice 'PASS: cash, QR, capacity, conversion, refunds, cancellation, extension, history and participant isolation';
end $$;
rollback;
