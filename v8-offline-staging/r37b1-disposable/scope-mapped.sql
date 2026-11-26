-- R37B1 REVIEW ONLY. Replacement for saved 20261124 SCOPED_POINT_ACCESS_CANDIDATE.sql.
-- No seed grants. Approve grant matrix and check legacy/service callers before deployment.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
CREATE TABLE private.staff_point_store_grants_v1 (
 staff_id uuid NOT NULL REFERENCES fixture.staff_profiles(id),
 store_id uuid NOT NULL REFERENCES fixture.stores(id),
 permission_key text NOT NULL CHECK(permission_key IN ('point.visit.award','checkout.execute')),
 active boolean NOT NULL DEFAULT false,
 PRIMARY KEY(staff_id,store_id,permission_key)
);
ALTER TABLE private.staff_point_store_grants_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.staff_point_store_grants_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.require_staff_point_store_v1(p_store_id uuid,p_permission text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE profile fixture.staff_profiles%ROWTYPE;
BEGIN
 IF p_store_id IS NULL OR p_permission IS NULL OR p_permission NOT IN ('point.visit.award','checkout.execute') THEN RAISE EXCEPTION 'invalid scope' USING ERRCODE='42501'; END IF;
 SELECT * INTO profile FROM fixture.staff_profiles WHERE id=auth.uid() AND active AND retired_at IS NULL FOR SHARE;
 IF NOT FOUND OR fixture.is_shop_staff() IS DISTINCT FROM true OR fixture.is_staff_business_session_current() IS DISTINCT FROM true THEN RAISE EXCEPTION 'staff session required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM fixture.stores WHERE id=p_store_id AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'inactive store' USING ERRCODE='42501'; END IF;
 IF profile.role='super_admin' THEN RETURN; END IF;
 PERFORM 1 FROM private.staff_point_store_grants_v1 WHERE staff_id=profile.id AND store_id=p_store_id AND permission_key=p_permission AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'store operation denied' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.require_staff_point_store_v1(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.scoped_point_operation_v1(p_operation text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE shop uuid; action text; token text;
BEGIN
 IF auth.uid() IS NULL OR fixture.is_shop_staff() IS DISTINCT FROM true OR fixture.is_staff_business_session_current() IS DISTINCT FROM true THEN RAISE EXCEPTION 'staff session required' USING ERRCODE='42501'; END IF;
 IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' THEN RAISE EXCEPTION 'invalid input' USING ERRCODE='22023'; END IF;
 shop:=(p_input->>'p_store_id')::uuid; action:=p_input->>'p_action'; token:=p_input->>'p_card_token';
 IF p_operation IN ('award_visit_point_for_card_v1','process_checkout_once_for_card_v1') THEN
  -- Unlike the null-token legacy path, the card endpoint must always prove possession.
  IF token IS NULL OR token !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'valid card token required' USING ERRCODE='42501'; END IF;
  IF p_operation='award_visit_point_for_card_v1' THEN
   PERFORM private.require_staff_point_store_v1(shop,'point.visit.award');
   RETURN to_jsonb(fixture.award_visit_point_checked_v2((p_input->>'p_member_id')::uuid,shop,token,NULL::uuid));
  ELSE
   PERFORM private.require_staff_point_store_v1(shop,'checkout.execute');
   RETURN fixture.process_checkout_once_checked_v2((p_input->>'p_request_id')::uuid,(p_input->>'p_member_id')::uuid,shop,(p_input->>'p_total_yen')::integer,(p_input->>'p_redeem_points')::integer,token,NULL::uuid);
  END IF;
 ELSIF p_operation='manage_card_directory_points_v1' THEN
  IF action='visit' THEN PERFORM private.require_staff_point_store_v1(shop,'point.visit.award');
  ELSIF action='checkout' THEN PERFORM private.require_staff_point_store_v1(shop,'checkout.execute');
  ELSIF action IS NULL OR action NOT IN ('select','encounter') THEN RAISE EXCEPTION 'invalid directory operation' USING ERRCODE='22023'; END IF;
  RETURN fixture.manage_card_directory_points_v1((p_input->>'p_card_id')::uuid,action,shop,(p_input->>'p_request_id')::uuid,(p_input->>'p_total_yen')::integer,(p_input->>'p_redeem_points')::integer);
 END IF;
 RAISE EXCEPTION 'operation denied' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION private.scoped_point_operation_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.scoped_point_operation_v1(text,jsonb) TO authenticated;
CREATE FUNCTION public.staff_scoped_point_operation_v1(p_operation text,p_input jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' BEGIN ATOMIC SELECT private.scoped_point_operation_v1(p_operation,p_input); END;
REVOKE ALL ON FUNCTION public.staff_scoped_point_operation_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.staff_scoped_point_operation_v1(text,jsonb) TO authenticated;
CREATE FUNCTION private.point_operation_stores_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE profile fixture.staff_profiles%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO profile FROM fixture.staff_profiles WHERE id=auth.uid() AND active AND retired_at IS NULL;
 IF NOT FOUND OR fixture.is_shop_staff() IS DISTINCT FROM true OR fixture.is_staff_business_session_current() IS DISTINCT FROM true THEN RAISE EXCEPTION 'staff session required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'permissions',p.permissions) ORDER BY s.name,s.id),'[]'::jsonb) INTO result
 FROM fixture.stores s CROSS JOIN LATERAL (
 SELECT jsonb_agg(k.permission_key ORDER BY k.permission_key) AS permissions
 FROM (VALUES ('point.visit.award'),('checkout.execute')) k(permission_key)
 WHERE profile.role='super_admin' OR EXISTS(SELECT 1 FROM private.staff_point_store_grants_v1 g WHERE g.staff_id=profile.id AND g.store_id=s.id AND g.permission_key=k.permission_key AND g.active)
 ) p WHERE s.active AND p.permissions IS NOT NULL;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.point_operation_stores_v1() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.point_operation_stores_v1() TO authenticated;
CREATE FUNCTION public.staff_point_operation_stores_v1()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' BEGIN ATOMIC SELECT private.point_operation_stores_v1(); END;
REVOKE ALL ON FUNCTION public.staff_point_operation_stores_v1() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.staff_point_operation_stores_v1() TO authenticated;
CREATE OR REPLACE FUNCTION public.award_visit_point_for_card_v1(p_member_id uuid,p_store_id uuid,p_card_token text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' BEGIN ATOMIC
 SELECT (private.scoped_point_operation_v1('award_visit_point_for_card_v1',jsonb_build_object('p_member_id',p_member_id,'p_store_id',p_store_id,'p_card_token',p_card_token))#>>'{}')::uuid;
END;
CREATE OR REPLACE FUNCTION public.process_checkout_once_for_card_v1(p_request_id uuid,p_member_id uuid,p_store_id uuid,p_total_yen integer,p_redeem_points integer,p_card_token text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' BEGIN ATOMIC
 SELECT private.scoped_point_operation_v1('process_checkout_once_for_card_v1',jsonb_build_object('p_request_id',p_request_id,'p_member_id',p_member_id,'p_store_id',p_store_id,'p_total_yen',p_total_yen,'p_redeem_points',p_redeem_points,'p_card_token',p_card_token));
END;
CREATE OR REPLACE FUNCTION public.manage_card_directory_points_v1(p_card_id uuid,p_action text,p_store_id uuid DEFAULT NULL,p_request_id uuid DEFAULT NULL,p_total_yen integer DEFAULT NULL,p_redeem_points integer DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' BEGIN ATOMIC
 SELECT private.scoped_point_operation_v1('manage_card_directory_points_v1',jsonb_build_object('p_card_id',p_card_id,'p_action',p_action,'p_store_id',p_store_id,'p_request_id',p_request_id,'p_total_yen',p_total_yen,'p_redeem_points',p_redeem_points));
END;
REVOKE EXECUTE ON FUNCTION private.award_visit_point_checked_v1(uuid,uuid,text),fixture.award_visit_point_checked_v2(uuid,uuid,text,uuid),private.process_checkout_once_checked_v1(uuid,uuid,uuid,integer,integer,text),fixture.process_checkout_once_checked_v2(uuid,uuid,uuid,integer,integer,text,uuid),fixture.manage_card_directory_points_v1(uuid,text,uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.award_visit_point(uuid,uuid),public.process_checkout(uuid,uuid,integer,integer),public.process_checkout_once(uuid,uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.award_visit_point_for_card_v1(uuid,uuid,text),public.process_checkout_once_for_card_v1(uuid,uuid,uuid,integer,integer,text),public.manage_card_directory_points_v1(uuid,text,uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.award_visit_point_for_card_v1(uuid,uuid,text),public.process_checkout_once_for_card_v1(uuid,uuid,uuid,integer,integer,text),public.manage_card_directory_points_v1(uuid,text,uuid,uuid,integer,integer) TO authenticated;
-- Existing owner receipt lookup is unchanged. No grants seeded.
NOTIFY pgrst,'reload schema';
COMMIT;
