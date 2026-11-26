-- Synthetic records only. No Supabase network or credentials.
DO $$ DECLARE f text; r text; BEGIN
 FOREACH f IN ARRAY ARRAY['public.award_visit_point(uuid,uuid)','public.process_checkout(uuid,uuid,integer,integer)','public.process_checkout_once(uuid,uuid,uuid,integer,integer)','private.award_visit_point_checked_v1(uuid,uuid,text)','private.process_checkout_once_checked_v1(uuid,uuid,uuid,integer,integer,text)','fixture.award_visit_point_checked_v2(uuid,uuid,text,uuid)','fixture.process_checkout_once_checked_v2(uuid,uuid,uuid,integer,integer,text,uuid)','fixture.manage_card_directory_points_v1(uuid,text,uuid,uuid,integer,integer)','private.require_staff_point_store_v1(uuid,text)'] LOOP
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF has_function_privilege(r,f,'EXECUTE') THEN RAISE EXCEPTION 'unprotected % %',r,f; END IF;
  END LOOP;
 END LOOP;
END $$;
INSERT INTO fixture.stores VALUES('00000000-0000-0000-0000-000000000003','Synthetic A',true,5),('00000000-0000-0000-0000-000000000008','Synthetic B',true,7);
INSERT INTO fixture.staff_profiles(id,role,default_store_id,active,display_name,encounter_points_enabled) VALUES('00000000-0000-0000-0000-000000000001','store_admin','00000000-0000-0000-0000-000000000003',true,'Synthetic staff',true);
INSERT INTO auth.sessions VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',now());
INSERT INTO fixture.directory_point_grants VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003');
INSERT INTO fixture.members(id,display_name) VALUES('00000000-0000-0000-0000-000000000004','Synthetic member');
INSERT INTO fixture.member_card_credentials(id,member_id,issued_store_id,token_hash,card_number,issued_at,issued_by) VALUES('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003',extensions.digest(repeat('A',43),'sha256'),900001,now(),'00000000-0000-0000-0000-000000000001');
INSERT INTO fixture.point_transactions(member_id,kind,delta) VALUES('00000000-0000-0000-0000-000000000004','seed',100);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"00000000-0000-0000-0000-000000000002"}',false);
SET ROLE authenticated;
DO $$ DECLARE m uuid:='00000000-0000-0000-0000-000000000004'; a uuid:='00000000-0000-0000-0000-000000000003'; c uuid:='00000000-0000-0000-0000-000000000005'; r uuid:='00000000-0000-0000-0000-000000000011';
BEGIN
 IF public.staff_point_operation_stores_v1()<>'[]'::jsonb THEN RAISE EXCEPTION 'implicit grant'; END IF;
 BEGIN PERFORM public.award_visit_point_for_card_v1(m,a,repeat('A',43)); RAISE EXCEPTION 'visit allowed without grant'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.process_checkout_once_for_card_v1(r,m,a,100,0,repeat('A',43)); RAISE EXCEPTION 'checkout allowed without grant'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.manage_card_directory_points_v1(c,'checkout',a,r,100,0); RAISE EXCEPTION 'directory allowed without grant'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO private.staff_point_store_grants_v1 VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','checkout.execute',true);
SET ROLE authenticated;
DO $$ DECLARE m uuid:='00000000-0000-0000-0000-000000000004'; a uuid:='00000000-0000-0000-0000-000000000003'; b uuid:='00000000-0000-0000-0000-000000000008'; c uuid:='00000000-0000-0000-0000-000000000005'; r uuid:='00000000-0000-0000-0000-000000000011'; d jsonb;
BEGIN
 d:=public.staff_point_operation_stores_v1(); IF jsonb_array_length(d)<>1 OR d->0->'permissions'<>'["checkout.execute"]'::jsonb THEN RAISE EXCEPTION 'store list mismatch'; END IF;
 BEGIN PERFORM public.process_checkout_once_for_card_v1(r,m,a,100,0,NULL); RAISE EXCEPTION 'null card accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.staff_scoped_point_operation_v1('process_checkout_once_for_card_v1',jsonb_build_object('p_request_id',r,'p_member_id',m,'p_store_id',a,'p_total_yen',100,'p_redeem_points',0)); RAISE EXCEPTION 'missing card accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.process_checkout_once_for_card_v1(r,m,b,100,0,repeat('A',43)); RAISE EXCEPTION 'wrong store accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.award_visit_point_for_card_v1(m,a,repeat('A',43)); RAISE EXCEPTION 'visit grant inferred'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 d:=public.process_checkout_once_for_card_v1(r,m,a,100,0,repeat('A',43)); IF d->>'balance_after'<>'105' OR d->>'replayed'<>'false' THEN RAISE EXCEPTION 'legacy result mismatch'; END IF;
 d:=public.manage_card_directory_points_v1(c,'checkout',a,'00000000-0000-0000-0000-000000000012',100,0); IF d->>'balance_after'<>'110' THEN RAISE EXCEPTION 'directory result mismatch'; END IF;
END $$;
RESET ROLE;
UPDATE private.staff_point_store_grants_v1 SET active=false;
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.process_checkout_once_for_card_v1('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003',100,0,repeat('A',43)); RAISE EXCEPTION 'revoked grant accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN IF (SELECT count(*) FROM fixture.checkout_requests)<>2 OR (SELECT sum(delta) FROM fixture.point_transactions)<>110 THEN RAISE EXCEPTION 'side effect mismatch'; END IF; END $$;
SELECT 'R37B1 legacy and scoped assertions PASS';
