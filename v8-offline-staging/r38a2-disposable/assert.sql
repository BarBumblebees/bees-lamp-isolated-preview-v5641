-- R37B2 distinct integration checks with actual R37B1 prerequisite. Disposable only.
INSERT INTO fixture.stores VALUES('00000000-0000-0000-0000-000000000003'::uuid,'Synthetic A',true,5),('00000000-0000-0000-0000-000000000008'::uuid,'Synthetic B',true,7);
INSERT INTO fixture.staff_profiles(id,role,default_store_id,active,display_name,encounter_points_enabled) VALUES('00000000-0000-0000-0000-000000000001'::uuid,'store_admin','00000000-0000-0000-0000-000000000003'::uuid,true,'Synthetic writer',true),('00000000-0000-0000-0000-000000000006'::uuid,'store_admin','00000000-0000-0000-0000-000000000003'::uuid,true,'Synthetic other',false);
INSERT INTO auth.sessions VALUES('00000000-0000-0000-0000-000000000002'::uuid,'00000000-0000-0000-0000-000000000001'::uuid,now()),('00000000-0000-0000-0000-000000000007'::uuid,'00000000-0000-0000-0000-000000000006'::uuid,now());
INSERT INTO fixture.directory_point_grants VALUES('00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-000000000003'::uuid),('00000000-0000-0000-0000-000000000006'::uuid,'00000000-0000-0000-0000-000000000003'::uuid);
INSERT INTO fixture.members(id,display_name) VALUES('00000000-0000-0000-0000-000000000004'::uuid,'Synthetic A'),('00000000-0000-0000-0000-000000000009'::uuid,'Synthetic B');
INSERT INTO fixture.member_card_credentials(id,member_id,issued_store_id,token_hash,card_number,issued_at,issued_by) VALUES('00000000-0000-0000-0000-000000000005'::uuid,'00000000-0000-0000-0000-000000000004'::uuid,'00000000-0000-0000-0000-000000000003'::uuid,extensions.digest(repeat('A',43),'sha256'),900001,now(),'00000000-0000-0000-0000-000000000001'::uuid),('00000000-0000-0000-0000-000000000010'::uuid,'00000000-0000-0000-0000-000000000009'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,extensions.digest(repeat('B',43),'sha256'),900002,now(),'00000000-0000-0000-0000-000000000001'::uuid);
INSERT INTO fixture.point_transactions(member_id,kind,delta) VALUES('00000000-0000-0000-0000-000000000004'::uuid,'seed',100);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-0000-0000-000000000001'::uuid,'session_id','00000000-0000-0000-0000-000000000002'::uuid,'role','authenticated')::text,false);

-- Capability flags independent of card read result; no mutation in this test.
SET ROLE authenticated;
DO $$ DECLARE d jsonb; BEGIN d:=public.ml40_api_scan_checkout_snapshot_v1('00000000-0000-0000-0000-000000000009'::uuid,'00000000-0000-0000-0000-000000000010'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,repeat('B',43)); IF d->'scan_capability' IS DISTINCT FROM jsonb_build_object('version',1,'environment','isolated','actor_id','00000000-0000-0000-0000-000000000001'::uuid,'session_id','00000000-0000-0000-0000-000000000002'::uuid::text,'member_id','00000000-0000-0000-0000-000000000009'::uuid,'card_id','00000000-0000-0000-0000-000000000010'::uuid,'store_id','00000000-0000-0000-0000-000000000008'::uuid,'checkout',false,'visit',false,'encounter',true,'visit_delta',0) THEN RAISE EXCEPTION 'capability mismatch: %',d; END IF;BEGIN PERFORM public.ml40_api_scan_checkout_snapshot_v1('00000000-0000-0000-0000-000000000009'::uuid,'00000000-0000-0000-0000-000000000010'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,repeat('Z',43)); RAISE EXCEPTION 'unexpected acceptance'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;BEGIN PERFORM public.ml40_api_scan_checkout_snapshot_v1('00000000-0000-0000-0000-000000000004'::uuid,'00000000-0000-0000-0000-000000000010'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,repeat('B',43)); RAISE EXCEPTION 'unexpected acceptance'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;BEGIN PERFORM public.ml40_api_scan_checkout_snapshot_v1('00000000-0000-0000-0000-000000000009'::uuid,'00000000-0000-0000-0000-000000000005'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,repeat('B',43)); RAISE EXCEPTION 'unexpected acceptance'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END; END $$;
RESET ROLE;

INSERT INTO private.staff_point_store_grants_v1 VALUES('00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,'point.visit.award',true);
SET ROLE authenticated;
DO $$ DECLARE d jsonb; BEGIN d:=public.ml40_api_scan_checkout_snapshot_v1('00000000-0000-0000-0000-000000000009'::uuid,'00000000-0000-0000-0000-000000000010'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,repeat('B',43)); IF d->'scan_capability' IS DISTINCT FROM jsonb_build_object('version',1,'environment','isolated','actor_id','00000000-0000-0000-0000-000000000001'::uuid,'session_id','00000000-0000-0000-0000-000000000002'::uuid::text,'member_id','00000000-0000-0000-0000-000000000009'::uuid,'card_id','00000000-0000-0000-0000-000000000010'::uuid,'store_id','00000000-0000-0000-0000-000000000008'::uuid,'checkout',false,'visit',true,'encounter',true,'visit_delta',7) THEN RAISE EXCEPTION 'capability mismatch: %',d; END IF;d:=public.ml40_api_scan_checkout_snapshot_v1('00000000-0000-0000-0000-000000000009'::uuid,'00000000-0000-0000-0000-000000000010'::uuid,'00000000-0000-0000-0000-000000000003'::uuid,repeat('B',43)); IF d->'scan_capability' IS DISTINCT FROM jsonb_build_object('version',1,'environment','isolated','actor_id','00000000-0000-0000-0000-000000000001'::uuid,'session_id','00000000-0000-0000-0000-000000000002'::uuid::text,'member_id','00000000-0000-0000-0000-000000000009'::uuid,'card_id','00000000-0000-0000-0000-000000000010'::uuid,'store_id','00000000-0000-0000-0000-000000000003'::uuid,'checkout',false,'visit',false,'encounter',true,'visit_delta',0) THEN RAISE EXCEPTION 'capability mismatch: %',d; END IF; END $$;
RESET ROLE;

INSERT INTO private.staff_point_store_grants_v1 VALUES('00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,'checkout.execute',true);
SET ROLE authenticated;
DO $$ DECLARE d jsonb; BEGIN d:=public.ml40_api_scan_checkout_snapshot_v1('00000000-0000-0000-0000-000000000009'::uuid,'00000000-0000-0000-0000-000000000010'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,repeat('B',43)); IF d->'scan_capability' IS DISTINCT FROM jsonb_build_object('version',1,'environment','isolated','actor_id','00000000-0000-0000-0000-000000000001'::uuid,'session_id','00000000-0000-0000-0000-000000000002'::uuid::text,'member_id','00000000-0000-0000-0000-000000000009'::uuid,'card_id','00000000-0000-0000-0000-000000000010'::uuid,'store_id','00000000-0000-0000-0000-000000000008'::uuid,'checkout',true,'visit',true,'encounter',true,'visit_delta',7) THEN RAISE EXCEPTION 'capability mismatch: %',d; END IF; END $$;
RESET ROLE;

UPDATE fixture.staff_profiles SET encounter_points_enabled=false WHERE id='00000000-0000-0000-0000-000000000001'::uuid;
UPDATE private.staff_point_store_grants_v1 SET active=false WHERE staff_id='00000000-0000-0000-0000-000000000001'::uuid AND permission_key='point.visit.award';
SET ROLE authenticated;
DO $$ DECLARE d jsonb; BEGIN d:=public.ml40_api_scan_checkout_snapshot_v1('00000000-0000-0000-0000-000000000009'::uuid,'00000000-0000-0000-0000-000000000010'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,repeat('B',43)); IF d->'scan_capability' IS DISTINCT FROM jsonb_build_object('version',1,'environment','isolated','actor_id','00000000-0000-0000-0000-000000000001'::uuid,'session_id','00000000-0000-0000-0000-000000000002'::uuid::text,'member_id','00000000-0000-0000-0000-000000000009'::uuid,'card_id','00000000-0000-0000-0000-000000000010'::uuid,'store_id','00000000-0000-0000-0000-000000000008'::uuid,'checkout',true,'visit',false,'encounter',false,'visit_delta',0) THEN RAISE EXCEPTION 'capability mismatch: %',d; END IF; END $$;
RESET ROLE;

UPDATE private.staff_point_store_grants_v1 SET active=false WHERE staff_id='00000000-0000-0000-0000-000000000001'::uuid AND permission_key='checkout.execute';
SET ROLE authenticated;
DO $$ DECLARE d jsonb; BEGIN d:=public.ml40_api_scan_checkout_snapshot_v1('00000000-0000-0000-0000-000000000009'::uuid,'00000000-0000-0000-0000-000000000010'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,repeat('B',43)); IF d->'scan_capability' IS DISTINCT FROM jsonb_build_object('version',1,'environment','isolated','actor_id','00000000-0000-0000-0000-000000000001'::uuid,'session_id','00000000-0000-0000-0000-000000000002'::uuid::text,'member_id','00000000-0000-0000-0000-000000000009'::uuid,'card_id','00000000-0000-0000-0000-000000000010'::uuid,'store_id','00000000-0000-0000-0000-000000000008'::uuid,'checkout',false,'visit',false,'encounter',false,'visit_delta',0) THEN RAISE EXCEPTION 'capability mismatch: %',d; END IF;BEGIN PERFORM public.ml40_api_scan_checkout_confirm_v1('00000000-0000-0000-0000-000000000009'::uuid,'00000000-0000-0000-0000-000000000010'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,100,0,0,'0',repeat('B',43)); RAISE EXCEPTION 'unexpected acceptance'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END; END $$;
RESET ROLE;

UPDATE fixture.stores SET active=false WHERE id='00000000-0000-0000-0000-000000000008'::uuid;
SET ROLE authenticated;
DO $$ DECLARE d jsonb; BEGIN BEGIN PERFORM public.ml40_api_scan_checkout_snapshot_v1('00000000-0000-0000-0000-000000000009'::uuid,'00000000-0000-0000-0000-000000000010'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,repeat('B',43)); RAISE EXCEPTION 'unexpected acceptance'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END; END $$;
RESET ROLE;

UPDATE fixture.stores SET active=true WHERE id='00000000-0000-0000-0000-000000000008'::uuid;
UPDATE fixture.member_card_credentials SET revoked_at=now() WHERE id='00000000-0000-0000-0000-000000000010'::uuid;
SET ROLE authenticated;
DO $$ DECLARE d jsonb; BEGIN BEGIN PERFORM public.ml40_api_scan_checkout_snapshot_v1('00000000-0000-0000-0000-000000000009'::uuid,'00000000-0000-0000-0000-000000000010'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,repeat('B',43)); RAISE EXCEPTION 'unexpected acceptance'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END; END $$;
RESET ROLE;

UPDATE fixture.member_card_credentials SET revoked_at=NULL WHERE id='00000000-0000-0000-0000-000000000010'::uuid;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-0000-0000-000000000006'::uuid,'session_id','00000000-0000-0000-0000-000000000007'::uuid,'role','authenticated')::text,false);
SET ROLE authenticated;
DO $$ DECLARE d jsonb; BEGIN d:=public.ml40_api_scan_checkout_snapshot_v1('00000000-0000-0000-0000-000000000009'::uuid,'00000000-0000-0000-0000-000000000010'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,repeat('B',43)); IF d->'scan_capability' IS DISTINCT FROM jsonb_build_object('version',1,'environment','isolated','actor_id','00000000-0000-0000-0000-000000000006'::uuid,'session_id','00000000-0000-0000-0000-000000000007'::uuid::text,'member_id','00000000-0000-0000-0000-000000000009'::uuid,'card_id','00000000-0000-0000-0000-000000000010'::uuid,'store_id','00000000-0000-0000-0000-000000000008'::uuid,'checkout',false,'visit',false,'encounter',false,'visit_delta',0) THEN RAISE EXCEPTION 'capability mismatch: %',d; END IF; END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-0000-0000-000000000001'::uuid,'session_id','00000000-0000-0000-0000-000000000099'::uuid,'role','authenticated')::text,false);
SET ROLE authenticated;
DO $$ DECLARE d jsonb; BEGIN BEGIN PERFORM public.ml40_api_scan_checkout_snapshot_v1('00000000-0000-0000-0000-000000000009'::uuid,'00000000-0000-0000-0000-000000000010'::uuid,'00000000-0000-0000-0000-000000000008'::uuid,repeat('B',43)); RAISE EXCEPTION 'unexpected acceptance'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END; END $$;
RESET ROLE;

DO $$ BEGIN
 IF has_function_privilege('anon','public.ml40_api_scan_checkout_snapshot_v1(uuid,uuid,uuid,text)','EXECUTE') OR has_function_privilege('service_role','public.ml40_api_scan_checkout_snapshot_v1(uuid,uuid,uuid,text)','EXECUTE') OR NOT has_function_privilege('authenticated','public.ml40_api_scan_checkout_snapshot_v1(uuid,uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'RPC ACL'; END IF;
 IF (SELECT count(*) FROM private.ml40_checkout_confirmations_v1)<>0 OR (SELECT count(*) FROM private.ml40_operation_receipts_v1)<>0 OR (SELECT count(*) FROM fixture.checkout_requests)<>0 OR (SELECT count(*) FROM fixture.point_transactions)<>1 THEN RAISE EXCEPTION 'unexpected writes'; END IF;
END $$;
SELECT 'R38A2 capability SQL PASS';
