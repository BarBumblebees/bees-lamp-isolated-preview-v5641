-- R36D1 REVIEW ONLY. Apply only after reviewed scoped permission migration, R32A/B/C/D1/D2 and approved grant matrix. No automatic grants.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF to_regprocedure('private.require_staff_point_store_v1(uuid,text)') IS NULL
 OR to_regclass('private.staff_point_store_grants_v1') IS NULL
 OR to_regprocedure('public.staff_scoped_point_operation_v1(text,jsonb)') IS NULL
 OR to_regprocedure('public.staff_point_operation_stores_v1()') IS NULL THEN
  RAISE EXCEPTION 'reviewed scoped permission migration required first';
 END IF;
 IF has_function_privilege('authenticated','private.require_staff_point_store_v1(uuid,text)','EXECUTE') OR has_function_privilege('anon','private.require_staff_point_store_v1(uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'unexpected gate ACL'; END IF;
END $guard$;
CREATE FUNCTION private.ml40_require_store_operation_v1(p_store_id uuid,p_permission text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 IF p_store_id IS NULL OR p_permission IS NULL OR p_permission NOT IN ('point.visit.award','checkout.execute') THEN
  RAISE EXCEPTION 'invalid store operation' USING ERRCODE='42501';
 END IF;
 -- Same server-authoritative grant and row locks as saved scoped permission candidate.
 PERFORM private.require_staff_point_store_v1(p_store_id,p_permission);
END;
$function$;
REVOKE ALL ON FUNCTION private.ml40_require_store_operation_v1(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.ml40_api_directory_checkout_confirm_v1(p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer, p_expected_balance bigint, p_expected_revision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ DECLARE v_result jsonb; BEGIN IF auth.uid() IS NULL OR public.is_shop_staff() IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=auth.uid() AND active IS TRUE AND retired_at IS NULL) THEN RAISE EXCEPTION 'current authorized staff session required' USING ERRCODE='42501'; END IF; IF private.staff_directory_points_access_v1() IS DISTINCT FROM true THEN RAISE EXCEPTION 'directory operation permission required' USING ERRCODE='42501'; END IF; PERFORM private.ml40_require_store_operation_v1(p_store_id,'checkout.execute'); v_result := private.ml40_directory_checkout_confirm_v1(p_member_id,p_card_id,p_store_id,p_total,p_redeem,p_expected_balance,p_expected_revision) || pg_catalog.jsonb_build_object('actor_id',auth.uid(),'member_id',p_member_id,'card_id',p_card_id,'store_id',p_store_id,'total',p_total,'redeem',p_redeem,'balance_before',p_expected_balance,'revision_before',p_expected_revision); RETURN v_result || pg_catalog.jsonb_build_object('server_now',pg_catalog.clock_timestamp()); END; $function$;

CREATE OR REPLACE FUNCTION public.ml40_api_directory_checkout_once_v1(p_request_id uuid, p_confirmation_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ BEGIN IF auth.uid() IS NULL OR public.is_shop_staff() IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=auth.uid() AND active IS TRUE AND retired_at IS NULL) THEN RAISE EXCEPTION 'current authorized staff session required' USING ERRCODE='42501'; END IF; IF private.staff_directory_points_access_v1() IS DISTINCT FROM true THEN RAISE EXCEPTION 'directory operation permission required' USING ERRCODE='42501'; END IF; PERFORM private.ml40_require_store_operation_v1(p_store_id,'checkout.execute'); RETURN private.ml40_directory_checkout_once_v1(p_request_id,p_confirmation_id,p_member_id,p_card_id,p_store_id,p_total,p_redeem); END; $function$;

CREATE OR REPLACE FUNCTION public.ml40_api_directory_point_once_v1(p_request_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_action text, p_expected_delta integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ BEGIN IF auth.uid() IS NULL OR public.is_shop_staff() IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=auth.uid() AND active IS TRUE AND retired_at IS NULL) THEN RAISE EXCEPTION 'current authorized staff session required' USING ERRCODE='42501'; END IF; IF private.staff_directory_points_access_v1() IS DISTINCT FROM true THEN RAISE EXCEPTION 'directory operation permission required' USING ERRCODE='42501'; END IF; IF p_action='visit' THEN PERFORM private.ml40_require_store_operation_v1(p_store_id,'point.visit.award'); END IF; RETURN private.ml40_directory_point_once_v1(p_request_id,p_member_id,p_card_id,p_store_id,p_action,p_expected_delta); END; $function$;

CREATE OR REPLACE FUNCTION public.ml40_api_scan_checkout_confirm_v1(p_member_id uuid,p_card_id uuid,p_store_id uuid,p_total integer,p_redeem integer,p_expected_balance bigint,p_expected_revision text,p_card_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ BEGIN PERFORM private.ml40_require_store_operation_v1(p_store_id,'checkout.execute'); RETURN private.ml40_scan_checkout_confirm_v1(p_member_id,p_card_id,p_store_id,p_total,p_redeem,p_expected_balance,p_expected_revision,p_card_token)||jsonb_build_object('actor_id',auth.uid(),'member_id',p_member_id,'card_id',p_card_id,'store_id',p_store_id,'total',p_total,'redeem',p_redeem,'balance_before',p_expected_balance,'revision_before',p_expected_revision,'server_now',clock_timestamp()); END; $function$;

CREATE OR REPLACE FUNCTION public.ml40_api_scan_checkout_once_v1(p_request_id uuid,p_confirmation_id uuid,p_member_id uuid,p_card_id uuid,p_store_id uuid,p_total integer,p_redeem integer,p_card_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ BEGIN PERFORM private.ml40_require_store_operation_v1(p_store_id,'checkout.execute'); RETURN private.ml40_scan_checkout_once_v1(p_request_id,p_confirmation_id,p_member_id,p_card_id,p_store_id,p_total,p_redeem,p_card_token); END; $function$;

CREATE OR REPLACE FUNCTION public.ml40_api_scan_point_once_v1(p_request_id uuid,p_member_id uuid,p_card_id uuid,p_store_id uuid,p_action text,p_expected_delta integer,p_card_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ BEGIN IF p_action='visit' THEN PERFORM private.ml40_require_store_operation_v1(p_store_id,'point.visit.award'); END IF; RETURN private.ml40_scan_point_once_v1(p_request_id,p_member_id,p_card_id,p_store_id,p_action,p_expected_delta,p_card_token); END; $function$;
COMMIT;
