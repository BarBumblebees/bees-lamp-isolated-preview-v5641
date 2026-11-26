-- R38A1 DRAFT. Require R37B1 + R32/R36 complete chain. No production deployment.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
CREATE OR REPLACE FUNCTION public.ml40_api_scan_checkout_snapshot_v1(p_member_id uuid,p_card_id uuid,p_store_id uuid,p_card_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_role text; v_snap jsonb; v_checkout boolean; v_visit boolean; v_encounter boolean; v_delta integer;
BEGIN
 v_role:=private.ml40_scan_scope_v1(p_store_id);
 SELECT sp.encounter_points_enabled IS TRUE INTO STRICT v_encounter FROM public.staff_profiles sp WHERE sp.id=auth.uid() AND sp.active IS TRUE AND sp.retired_at IS NULL;
 SELECT s.visit_points INTO STRICT v_delta FROM public.stores s WHERE s.id=p_store_id AND s.active IS TRUE;
 SELECT v_role='super_admin' OR EXISTS(SELECT 1 FROM private.staff_point_store_grants_v1 g WHERE g.staff_id=auth.uid() AND g.store_id=p_store_id AND g.permission_key='checkout.execute' AND g.active) INTO v_checkout;
 SELECT v_role='super_admin' OR EXISTS(SELECT 1 FROM private.staff_point_store_grants_v1 g WHERE g.staff_id=auth.uid() AND g.store_id=p_store_id AND g.permission_key='point.visit.award' AND g.active) INTO v_visit;
 v_visit:=v_visit AND v_delta>0;
 v_snap:=private.ml40_scan_snapshot_locked_v1(p_member_id,p_card_id,p_store_id,p_card_token);
 RETURN v_snap||jsonb_build_object('member_id',p_member_id,'card_id',p_card_id,'store_id',p_store_id,'route','scan',
 'scan_capability',jsonb_build_object('version',1,'environment','production','actor_id',auth.uid(),'session_id',auth.jwt()->>'session_id','member_id',p_member_id,'card_id',p_card_id,'store_id',p_store_id,'checkout',v_checkout,'visit',v_visit,'encounter',v_encounter,'visit_delta',CASE WHEN v_visit THEN v_delta ELSE 0 END));
END;
$function$;
REVOKE ALL ON FUNCTION public.ml40_api_scan_checkout_snapshot_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ml40_api_scan_checkout_snapshot_v1(uuid,uuid,uuid,text) TO authenticated;
COMMIT;
