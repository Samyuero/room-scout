-- Run in Supabase SQL Editor against a test/shared development project.
-- All synthetic users, listings, receipts and notifications roll back.
begin;
set local statement_timeout = '30s';
set local plpgsql.check_asserts = on;
do $$
declare
  owner_uid uuid := gen_random_uuid();
  renter_uid uuid := gen_random_uuid();
  other_uid uuid := gen_random_uuid();
  admin_uid uuid := gen_random_uuid();
  dorm_uid uuid := gen_random_uuid();
  request_uid uuid;
  rental_uid uuid;
  payment_method text;
  request_type text;
  request_state text;
  current_row public.rental_requests%rowtype;
  checks integer := 0;
  blocked boolean;
begin
  insert into auth.users(id,raw_user_meta_data) values
    (owner_uid,'{"full_name":"Workflow test owner","role":"owner"}'),
    (renter_uid,'{"full_name":"Workflow test renter","role":"renter"}'),
    (other_uid,'{"full_name":"Workflow test other renter","role":"renter"}'),
    (admin_uid,'{"full_name":"Workflow test admin","role":"renter"}');
  insert into public.admins(admin_id) values(admin_uid);
  perform set_config('roomscout.test.owner',owner_uid::text,true);
  perform set_config('roomscout.test.renter',renter_uid::text,true);
  perform set_config('roomscout.test.other',other_uid::text,true);
  perform set_config('roomscout.test.admin',admin_uid::text,true);
  perform set_config('roomscout.test.dorm',dorm_uid::text,true);
  perform set_config('request.jwt.claim.sub',admin_uid::text,true);
  insert into public.dorms(dorm_id,name,address,price,latitude,longitude,gender_policy,owner_id,max_tenants,occupied_tenants,reservation_fee,approval_status,available)
  values(dorm_uid,'Workflow fixture — rolled back','Opao test',5000,10.3267,123.9555,'co-ed',owner_uid,2,0,500,'approved',true);

  -- Both payment methods, both request types, before and after acceptance.
  foreach payment_method in array array['cash','qr'] loop
    foreach request_type in array array['rental','reservation'] loop
      foreach request_state in array array['pending','accepted'] loop
        perform set_config('request.jwt.claim.sub',renter_uid::text,true);
        insert into public.rental_requests(dorm_id,user_id,owner_id,request_type,payment_method,renter_gov_id_url)
        values(dorm_uid,renter_uid,owner_uid,request_type,payment_method,renter_uid||'/government-id/test.jpg') returning request_id into request_uid;
        if request_state = 'accepted' then
          perform set_config('request.jwt.claim.sub',owner_uid::text,true);
          if payment_method = 'cash' then
            perform public.owner_accept_cash_request(request_uid);
          else
            update public.rental_requests set status='awaiting_payment',required_amount=5000,
              owner_payment_qr_url=owner_uid||'/qrcodes/test.jpg',contract_url=owner_uid||'/contracts/test.jpg'
            where request_id=request_uid;
          end if;
        end if;
        perform set_config('request.jwt.claim.sub',other_uid::text,true);
        blocked := false;
        begin perform public.cancel_rental_request(request_uid);
        exception when others then blocked := true; end;
        assert blocked, 'Another renter cancelled this request'; checks := checks+1;

        perform set_config('request.jwt.claim.sub',renter_uid::text,true);
        perform public.cancel_rental_request(request_uid);
        perform public.cancel_rental_request(request_uid); -- retry must be harmless
        select * into current_row from public.rental_requests where request_id=request_uid;
        assert current_row.status='cancelled' and current_row.payment_status='unpaid', 'Unpaid cancellation failed';
        assert (select occupied_tenants=0 from public.dorms where dorm_id=dorm_uid), 'Unpaid cancellation freed an unrelated bed';
        assert (select count(*)=2 from public.notifications where related_request_id=request_uid and type='request_cancelled'), 'Cancellation notices missing';
        checks := checks+3;

        if payment_method='cash' then
          perform set_config('request.jwt.claim.sub',owner_uid::text,true);
          blocked := false;
          begin perform public.owner_confirm_cash_payment(request_uid);
          exception when others then blocked := true; end;
          assert blocked, 'Owner confirmed a cancelled request'; checks := checks+1;
        end if;
      end loop;
    end loop;
  end loop;

  -- Happy-path payment confirmation, capacity, cancellation and idempotence.
  foreach payment_method in array array['cash','qr'] loop
    foreach request_type in array array['rental','reservation'] loop
      perform set_config('request.jwt.claim.sub',renter_uid::text,true);
      insert into public.rental_requests(dorm_id,user_id,owner_id,request_type,payment_method,renter_gov_id_url)
      values(dorm_uid,renter_uid,owner_uid,request_type,payment_method,renter_uid||'/government-id/test.jpg') returning request_id into request_uid;
      perform set_config('request.jwt.claim.sub',owner_uid::text,true);
      if payment_method='cash' then
        perform public.owner_accept_cash_request(request_uid);
        perform public.owner_confirm_cash_payment(request_uid);
      else
        update public.rental_requests set status='awaiting_payment',required_amount=5000,
          owner_payment_qr_url=owner_uid||'/qrcodes/test.jpg',contract_url=owner_uid||'/contracts/test.jpg' where request_id=request_uid;
        perform set_config('request.jwt.claim.sub',renter_uid::text,true);
        update public.rental_requests set status='payment_submitted',payment_status='pending_verification',contract_agreed=true,
          payment_proof_url=renter_uid||'/payment-proof/test.jpg' where request_id=request_uid;
        perform set_config('request.jwt.claim.sub',admin_uid::text,true);
        perform public.admin_verify_payment(request_uid,true);
      end if;
      select * into current_row from public.rental_requests where request_id=request_uid;
      assert current_row.status=case when request_type='rental' then 'approved' else 'reserved' end
        and current_row.payment_status='paid' and current_row.payment_verified_at is not null, 'Payment confirmation failed';
      assert (select occupied_tenants=1 from public.dorms where dorm_id=dorm_uid), 'Confirmation did not allocate exactly one bed';
      assert (select count(*)=case when request_type='rental' then 1 else 0 end from public.rentals where dorm_id=dorm_uid and status='active'), 'Tenant creation does not match request type';
      checks := checks+3;
      blocked := false;
      begin
        if payment_method='cash' then perform public.owner_confirm_cash_payment(request_uid);
        else perform public.admin_verify_payment(request_uid,true); end if;
      exception when others then blocked := true; end;
      assert blocked, 'Payment was confirmed twice'; checks := checks+1;
      perform set_config('request.jwt.claim.sub',renter_uid::text,true);
      perform public.cancel_rental_request(request_uid);
      perform public.cancel_rental_request(request_uid);
      select * into current_row from public.rental_requests where request_id=request_uid;
      assert current_row.status='cancelled' and current_row.payment_status='paid' and current_row.payment_verified_at is not null, 'Cancellation erased payment history';
      assert (select occupied_tenants=0 and available from public.dorms where dorm_id=dorm_uid), 'Paid cancellation failed to release one bed';
      assert not exists(select 1 from public.rentals where dorm_id=dorm_uid and status='active'), 'Cancelled rental still active';
      checks := checks+3;
    end loop;
  end loop;

  -- A submitted receipt must still be reviewed, but never revive a cancellation.
  foreach request_state in array array['approve','reject'] loop
    perform set_config('request.jwt.claim.sub',renter_uid::text,true);
    insert into public.rental_requests(dorm_id,user_id,owner_id,payment_method,renter_gov_id_url)
    values(dorm_uid,renter_uid,owner_uid,'qr',renter_uid||'/government-id/test.jpg') returning request_id into request_uid;
    perform set_config('request.jwt.claim.sub',owner_uid::text,true);
    update public.rental_requests set status='awaiting_payment',required_amount=5000,
      owner_payment_qr_url=owner_uid||'/qrcodes/test.jpg',contract_url=owner_uid||'/contracts/test.jpg' where request_id=request_uid;
    perform set_config('request.jwt.claim.sub',renter_uid::text,true);
    update public.rental_requests set status='payment_submitted',payment_status='pending_verification',contract_agreed=true,
      payment_proof_url=renter_uid||'/payment-proof/test.jpg' where request_id=request_uid;
    perform public.cancel_rental_request(request_uid);
    assert (select status='cancelled' and payment_status='pending_verification' and payment_proof_url is not null from public.rental_requests where request_id=request_uid), 'Receipt lost on withdrawal'; checks := checks+1;
    perform set_config('request.jwt.claim.sub',admin_uid::text,true);
    perform public.admin_verify_payment(request_uid,request_state='approve');
    assert (select status='cancelled' and payment_proof_url is not null and payment_status=case when request_state='approve' then 'paid' else 'rejected' end from public.rental_requests where request_id=request_uid), 'Receipt review revived request or erased proof';
    assert (select occupied_tenants=0 from public.dorms where dorm_id=dorm_uid), 'Cancelled receipt review allocated bed'; checks := checks+2;
  end loop;

  -- Full-capacity guard and recovery. Cancellation reopens only its own slot.
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  insert into public.rental_requests(dorm_id,user_id,owner_id,payment_method) values(dorm_uid,renter_uid,owner_uid,'cash') returning request_id into request_uid;
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  perform public.owner_accept_cash_request(request_uid);
  update public.dorms set occupied_tenants=2,available=false,availability_status='unavailable' where dorm_id=dorm_uid;
  blocked := false;
  begin perform public.owner_confirm_cash_payment(request_uid); exception when others then blocked := true; end;
  assert blocked, 'Overbooking was allowed'; checks := checks+1;
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  perform public.cancel_rental_request(request_uid);
  assert (select occupied_tenants=2 and not available from public.dorms where dorm_id=dorm_uid), 'Unpaid cancellation freed another tenant slot'; checks := checks+1;

  -- Ending a rental and then cancelling its old request must not free a second bed.
  update public.dorms set occupied_tenants=0,available=true,availability_status='available' where dorm_id=dorm_uid;
  insert into public.rental_requests(dorm_id,user_id,owner_id,payment_method) values(dorm_uid,renter_uid,owner_uid,'cash') returning request_id into request_uid;
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  perform public.owner_accept_cash_request(request_uid);
  perform public.owner_confirm_cash_payment(request_uid);
  select rental_id into rental_uid from public.rentals where dorm_id=dorm_uid and user_id=renter_uid and status='active';
  perform public.owner_end_rental(rental_uid);
  update public.dorms set occupied_tenants=1 where dorm_id=dorm_uid; -- Another current tenant.
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  perform public.cancel_rental_request(request_uid);
  assert (select occupied_tenants=1 from public.dorms where dorm_id=dorm_uid), 'Ended rental cancellation released twice'; checks := checks+1;

  -- Duplicate submissions, decline/re-request, rejected receipt and resubmission.
  insert into public.rental_requests(dorm_id,user_id,owner_id,payment_method)
  values(dorm_uid,renter_uid,owner_uid,'qr') returning request_id into request_uid;
  blocked := false;
  begin insert into public.rental_requests(dorm_id,user_id,owner_id,payment_method) values(dorm_uid,renter_uid,owner_uid,'cash');
  exception when unique_violation then blocked := true; end;
  assert blocked, 'Duplicate open request allowed'; checks := checks+1;
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  update public.rental_requests set status='rejected' where request_id=request_uid;
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  insert into public.rental_requests(dorm_id,user_id,owner_id,payment_method)
  values(dorm_uid,renter_uid,owner_uid,'qr') returning request_id into request_uid;
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  update public.rental_requests set status='awaiting_payment',required_amount=5000,
    owner_payment_qr_url=owner_uid||'/qrcodes/test.jpg',contract_url=owner_uid||'/contracts/test.jpg' where request_id=request_uid;
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  update public.rental_requests set status='payment_submitted',payment_status='pending_verification',contract_agreed=true,
    payment_proof_url=renter_uid||'/payment-proof/first.jpg' where request_id=request_uid;
  perform set_config('request.jwt.claim.sub',admin_uid::text,true);
  perform public.admin_verify_payment(request_uid,false);
  assert (select status='awaiting_payment' and payment_status='rejected' and not contract_agreed from public.rental_requests where request_id=request_uid), 'Receipt rejection did not reopen payment step'; checks := checks+1;
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  update public.rental_requests set status='payment_submitted',payment_status='pending_verification',contract_agreed=true,
    payment_proof_url=renter_uid||'/payment-proof/corrected.jpg' where request_id=request_uid;
  perform set_config('request.jwt.claim.sub',admin_uid::text,true);
  perform public.admin_verify_payment(request_uid,true);
  assert (select occupied_tenants=2 and not available from public.dorms where dorm_id=dorm_uid), 'Corrected receipt confirmation failed'; checks := checks+1;
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  perform public.cancel_rental_request(request_uid);

  -- Cancelling a reservation must not end a separate active rental.
  update public.dorms set max_tenants=3 where dorm_id=dorm_uid;
  insert into public.rental_requests(dorm_id,user_id,owner_id,payment_method)
  values(dorm_uid,renter_uid,owner_uid,'cash') returning request_id into request_uid;
  perform set_config('roomscout.test.active_request',request_uid::text,true);
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  perform public.owner_accept_cash_request(request_uid);
  perform public.owner_confirm_cash_payment(request_uid);
  blocked := false;
  begin insert into public.rentals(dorm_id,user_id,status) values(dorm_uid,renter_uid,'active');
  exception when unique_violation then blocked := true; end;
  assert blocked, 'Duplicate active tenancy allowed'; checks := checks+1;
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  insert into public.rental_requests(dorm_id,user_id,owner_id,payment_method,request_type)
  values(dorm_uid,renter_uid,owner_uid,'cash','reservation') returning request_id into request_uid;
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  perform public.owner_accept_cash_request(request_uid);
  perform public.owner_confirm_cash_payment(request_uid);
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  perform public.cancel_rental_request(request_uid);
  assert exists(select 1 from public.rentals where dorm_id=dorm_uid and user_id=renter_uid and status='active'), 'Reservation cancellation ended unrelated rental'; checks := checks+1;
  assert (select occupied_tenants=2 from public.dorms where dorm_id=dorm_uid), 'Reservation cancellation released wrong number of slots'; checks := checks+1;
  perform public.cancel_rental_request(current_setting('roomscout.test.active_request')::uuid);
  update public.dorms set max_tenants=2 where dorm_id=dorm_uid;

  raise notice 'PASS: % rental workflow assertions; all fixtures roll back', checks;
end $$;

-- Exercise the same database role as the mobile app (not a superuser).
set local role authenticated;
do $$
declare
  owner_uid uuid := current_setting('roomscout.test.owner')::uuid;
  renter_uid uuid := current_setting('roomscout.test.renter')::uuid;
  other_uid uuid := current_setting('roomscout.test.other')::uuid;
  admin_uid uuid := current_setting('roomscout.test.admin')::uuid;
  dorm_uid uuid := current_setting('roomscout.test.dorm')::uuid;
  request_uid uuid;
  blocked boolean;
begin
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  insert into public.rental_requests(dorm_id,user_id,owner_id,payment_method,renter_gov_id_url)
  values(dorm_uid,renter_uid,owner_uid,'qr',renter_uid||'/government-id/test.jpg') returning request_id into request_uid;
  blocked := false;
  begin update public.rental_requests set status='cancelled',payment_status='paid' where request_id=request_uid;
  exception when others then blocked := true; end;
  assert blocked, 'Client forged payment status';
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  update public.rental_requests set status='awaiting_payment',required_amount=5000,
    owner_payment_qr_url=owner_uid||'/qrcodes/test.jpg',contract_url=owner_uid||'/contracts/test.jpg' where request_id=request_uid;
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  update public.rental_requests set status='payment_submitted',payment_status='pending_verification',contract_agreed=true,
    payment_proof_url=renter_uid||'/payment-proof/test.jpg' where request_id=request_uid;
  blocked := false;
  begin perform public.admin_verify_payment(request_uid,true); exception when others then blocked := true; end;
  assert blocked, 'Renter verified their own receipt';
  perform set_config('request.jwt.claim.sub',other_uid::text,true);
  assert not exists(select 1 from public.rental_requests where request_id=request_uid), 'Stranger can read request';
  blocked := false;
  begin perform public.cancel_rental_request(request_uid); exception when others then blocked := true; end;
  assert blocked, 'Stranger can cancel request';
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  perform public.cancel_rental_request(request_uid);
  blocked := false;
  begin update public.rental_requests set status='payment_submitted',payment_status='pending_verification' where request_id=request_uid;
  exception when others then blocked := true; end;
  assert blocked, 'Late receipt submission reopened cancellation';
  perform set_config('request.jwt.claim.sub',admin_uid::text,true);
  perform public.admin_verify_payment(request_uid,true);
  assert (select status='cancelled' and payment_status='paid' from public.rental_requests where request_id=request_uid), 'Authenticated admin receipt review failed';

  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  insert into public.rental_requests(dorm_id,user_id,owner_id,payment_method)
  values(dorm_uid,renter_uid,owner_uid,'cash') returning request_id into request_uid;
  perform set_config('request.jwt.claim.sub',owner_uid::text,true);
  perform public.owner_accept_cash_request(request_uid);
  blocked := false;
  begin update public.rental_requests set status='approved',payment_status='paid' where request_id=request_uid;
  exception when others then blocked := true; end;
  assert blocked, 'Owner bypassed atomic cash confirmation';
  perform public.owner_confirm_cash_payment(request_uid);
  assert (select occupied_tenants=2 and not available from public.dorms where dorm_id=dorm_uid), 'Last-slot cash confirmation failed';
  perform set_config('request.jwt.claim.sub',renter_uid::text,true);
  perform public.cancel_rental_request(request_uid);
  assert (select occupied_tenants=1 and available from public.dorms where dorm_id=dorm_uid), 'Authenticated paid cancellation failed';
  blocked := false;
  begin insert into public.rental_requests(dorm_id,user_id,owner_id,payment_status) values(dorm_uid,renter_uid,owner_uid,'paid');
  exception when others then blocked := true; end;
  assert blocked, 'Client inserted an already-paid request';
  assert not has_function_privilege('anon','public.cancel_rental_request(uuid)','execute'), 'Anonymous cancellation allowed';
  raise notice 'PASS: authenticated RLS, payment tampering and late-update checks';
end $$;
reset role;
rollback;
select 'PASS: cash/QR rental/reservation cancellation and payment workflow assertions; fixtures rolled back' as result;
