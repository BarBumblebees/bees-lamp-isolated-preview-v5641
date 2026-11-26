-- R38A3 isolated-only synthetic C; do not apply production. Separate trial receipts/confirmations, shared existing balance revisions.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF (SELECT count(*) FROM ml40_r18_trial.members)<>3 OR (SELECT count(*) FROM ml40_r18_trial.member_card_credentials)<>3 OR (SELECT count(*) FROM ml40_r18_trial.checkout_requests)<>3 OR (SELECT count(*) FROM ml40_r18_trial.ml40_operation_receipts_v1)<>7 OR EXISTS(SELECT 1 FROM ml40_r18_trial.point_transactions WHERE member_id='18400000-0000-4000-8000-000000000013'::uuid) THEN RAISE EXCEPTION 'baseline changed'; END IF;
END $$;
CREATE SCHEMA ml40_r38a3_scan_trial;
REVOKE ALL ON SCHEMA ml40_r38a3_scan_trial FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE ml40_r38a3_scan_trial.ml40_operation_receipts_v1(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,member_id uuid NOT NULL CHECK(member_id='18400000-0000-4000-8000-000000000013'::uuid),card_id uuid NOT NULL CHECK(card_id='18400000-0000-4000-8000-000000000023'::uuid),store_id uuid NOT NULL CHECK(store_id='18400000-0000-4000-8000-000000000002'::uuid),action text NOT NULL CHECK(action IN ('checkout','visit')),result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),route text NOT NULL CHECK(route='scan'),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(action));
CREATE TABLE ml40_r38a3_scan_trial.ml40_checkout_confirmations_v1(confirmation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,member_id uuid NOT NULL CHECK(member_id='18400000-0000-4000-8000-000000000013'::uuid),card_id uuid NOT NULL CHECK(card_id='18400000-0000-4000-8000-000000000023'::uuid),store_id uuid NOT NULL CHECK(store_id='18400000-0000-4000-8000-000000000002'::uuid),total integer NOT NULL CHECK(total=100),redeem integer NOT NULL CHECK(redeem=0),balance_before bigint NOT NULL,revision_before bigint NOT NULL,expires_at timestamptz NOT NULL,route text NOT NULL CHECK(route='scan'),session_id uuid NOT NULL,consumed_request_id uuid UNIQUE REFERENCES ml40_r38a3_scan_trial.ml40_operation_receipts_v1(request_id));
ALTER TABLE ml40_r38a3_scan_trial.ml40_operation_receipts_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml40_r38a3_scan_trial.ml40_checkout_confirmations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA ml40_r38a3_scan_trial FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION ml40_r38a3_scan_trial.ml40_scan_scope_v1(p_store_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role text;
BEGIN
 IF p_store_id IS DISTINCT FROM '18400000-0000-4000-8000-000000000002'::uuid OR auth.uid() IS NULL OR ml40_r18_trial.is_shop_staff() IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND u.email='ml40-r22-writer@example.invalid') THEN RAISE EXCEPTION 'isolated writer/store only' USING ERRCODE='42501'; END IF;
 SELECT p.role INTO v_role FROM ml40_r18_trial.staff_profiles p WHERE p.id=auth.uid() AND p.active AND p.retired_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'staff inactive' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM ml40_r18_trial.stores s WHERE s.id=p_store_id AND s.active AND s.visit_points=7 FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'fixture store changed' USING ERRCODE='42501'; END IF;
 RETURN v_role;
END $$;
CREATE FUNCTION ml40_r38a3_scan_trial.ml40_scan_snapshot_locked_v1(p_member_id uuid, p_card_id uuid, p_store_id uuid, p_card_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_revision bigint; v_balance bigint;
BEGIN
  PERFORM ml40_r38a3_scan_trial.ml40_scan_scope_v1(p_store_id);
  IF p_member_id IS DISTINCT FROM '18400000-0000-4000-8000-000000000013'::uuid OR p_card_id IS DISTINCT FROM '18400000-0000-4000-8000-000000000023'::uuid OR p_card_token IS DISTINCT FROM 'R35D_TEST_ONLY_XXXXXXXXXXXXXXXXXXXXXXXXXXXX' THEN RAISE EXCEPTION 'synthetic card only' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM ml40_r18_trial.members m WHERE m.id=p_member_id FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid member' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM ml40_r18_trial.member_card_credentials c WHERE c.id=p_card_id AND c.member_id=p_member_id
    AND c.revoked_at IS NULL AND c.replaced_by IS NULL
    AND (p_card_token ~ '^[A-Za-z0-9_-]{43}$' AND c.token_hash=extensions.digest(p_card_token,'sha256')) FOR SHARE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid card binding' USING ERRCODE='42501'; END IF;
  INSERT INTO ml40_r18_trial.ml40_balance_versions_v1(member_id,revision) VALUES(p_member_id,0) ON CONFLICT (member_id) DO NOTHING;
  SELECT v.revision INTO STRICT v_revision FROM ml40_r18_trial.ml40_balance_versions_v1 v WHERE v.member_id=p_member_id FOR UPDATE OF v;
  SELECT coalesce(sum(t.delta),0) INTO v_balance FROM ml40_r18_trial.point_transactions t WHERE t.member_id=p_member_id;
  RETURN pg_catalog.jsonb_build_object('balance',v_balance,'revision',v_revision::text);
END;
$function$;
CREATE FUNCTION ml40_r38a3_scan_trial.ml40_scan_checkout_confirm_v1(p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer, p_expected_balance bigint, p_expected_revision text, p_card_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_role text; v_snap jsonb; v_id uuid; v_expires timestamptz; v_after bigint;
BEGIN
  IF p_total IS DISTINCT FROM 100 OR p_redeem IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'fixed trial checkout' USING ERRCODE='42501'; END IF;
  v_role:=ml40_r38a3_scan_trial.ml40_scan_scope_v1(p_store_id);
  IF p_total IS NULL OR p_total NOT BETWEEN 1 AND 100000000 OR p_redeem IS NULL OR p_redeem<0
    OR p_redeem>p_total OR p_redeem%10<>0 OR p_expected_balance IS NULL OR p_expected_balance NOT BETWEEN 0 AND 10000000
    OR p_redeem>p_expected_balance OR p_expected_revision IS NULL OR p_expected_revision !~ '^(0|[1-9][0-9]{0,18})$' THEN
    RAISE EXCEPTION 'invalid preview' USING ERRCODE='22023'; END IF;
  v_after:=p_expected_balance-p_redeem+((p_total-p_redeem)/100)*5;
  IF v_after NOT BETWEEN 0 AND 10000000 THEN RAISE EXCEPTION 'balance range' USING ERRCODE='22023'; END IF;
  v_snap:=ml40_r38a3_scan_trial.ml40_scan_snapshot_locked_v1(p_member_id,p_card_id,p_store_id,p_card_token);
  IF (v_snap->>'balance')::bigint IS DISTINCT FROM p_expected_balance OR v_snap->>'revision' IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale preview' USING ERRCODE='40001'; END IF;
  v_expires:=pg_catalog.clock_timestamp()+interval '2 minutes';
  INSERT INTO ml40_r38a3_scan_trial.ml40_checkout_confirmations_v1(actor_id,member_id,card_id,store_id,total,redeem,balance_before,revision_before,expires_at,route,session_id)
    VALUES(auth.uid(),p_member_id,p_card_id,p_store_id,p_total,p_redeem,p_expected_balance,p_expected_revision::bigint,v_expires,'scan',(auth.jwt()->>'session_id')::uuid)
    RETURNING confirmation_id INTO v_id;
  RETURN pg_catalog.jsonb_build_object('environment','isolated','route','scan','status','issued','confirmation_id',v_id,'expires_at',v_expires);
END;
$function$;
CREATE FUNCTION ml40_r38a3_scan_trial.ml40_scan_checkout_once_v1(p_request_id uuid, p_confirmation_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer, p_card_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_role text; v_old ml40_r38a3_scan_trial.ml40_operation_receipts_v1%ROWTYPE;
  v_confirm ml40_r38a3_scan_trial.ml40_checkout_confirmations_v1%ROWTYPE; v_snap jsonb; v_core jsonb; v_result jsonb;
  v_paid integer; v_earned integer; v_after bigint; v_final jsonb; v_expected_revision bigint;
BEGIN
  IF p_total IS DISTINCT FROM 100 OR p_redeem IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'fixed trial checkout' USING ERRCODE='42501'; END IF;
  v_role:=ml40_r38a3_scan_trial.ml40_scan_scope_v1(p_store_id);
  IF p_request_id IS NULL OR p_confirmation_id IS NULL OR p_member_id IS NULL OR p_card_id IS NULL OR p_total IS NULL OR p_redeem IS NULL THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ml40:'||p_request_id::text,0));
  -- Preserve legacy request-lock -> member-lock order; deletion takes member lock before deleting confirmations.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  PERFORM 1 FROM ml40_r18_trial.members m WHERE m.id=p_member_id FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid member' USING ERRCODE='42501'; END IF;
  SELECT r.* INTO v_old FROM ml40_r38a3_scan_trial.ml40_operation_receipts_v1 r WHERE r.request_id=p_request_id;
  IF FOUND THEN
    IF v_old.route IS DISTINCT FROM 'scan' OR v_old.actor_id IS DISTINCT FROM auth.uid() OR v_old.member_id IS DISTINCT FROM p_member_id OR v_old.card_id IS DISTINCT FROM p_card_id
      OR v_old.store_id IS DISTINCT FROM p_store_id OR v_old.action IS DISTINCT FROM 'checkout'
      OR v_old.result->>'confirmation_id' IS DISTINCT FROM p_confirmation_id::text
      OR v_old.result->'total' IS DISTINCT FROM pg_catalog.to_jsonb(p_total)
      OR v_old.result->'redeem' IS DISTINCT FROM pg_catalog.to_jsonb(p_redeem) THEN
      RAISE EXCEPTION 'request binding mismatch' USING ERRCODE='22023'; END IF;
    PERFORM ml40_r38a3_scan_trial.ml40_scan_snapshot_locked_v1(p_member_id,p_card_id,p_store_id,p_card_token); v_result:=v_old.result;
  ELSE
    IF EXISTS(SELECT 1 FROM ml40_r38a3_scan_trial.ml40_operation_receipts_v1 WHERE action='checkout') THEN RAISE EXCEPTION 'trial checkout already completed' USING ERRCODE='42501'; END IF;
    SELECT c.* INTO v_confirm FROM ml40_r38a3_scan_trial.ml40_checkout_confirmations_v1 c WHERE c.confirmation_id=p_confirmation_id FOR UPDATE OF c;
    IF NOT FOUND OR v_confirm.route IS DISTINCT FROM 'scan' OR v_confirm.session_id IS DISTINCT FROM (auth.jwt()->>'session_id')::uuid OR v_confirm.actor_id IS DISTINCT FROM auth.uid() OR v_confirm.member_id IS DISTINCT FROM p_member_id
      OR v_confirm.card_id IS DISTINCT FROM p_card_id OR v_confirm.store_id IS DISTINCT FROM p_store_id OR v_confirm.total IS DISTINCT FROM p_total
      OR v_confirm.redeem IS DISTINCT FROM p_redeem OR v_confirm.consumed_request_id IS NOT NULL OR v_confirm.expires_at<=pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION 'invalid or expired confirmation' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM ml40_r18_trial.checkout_requests r WHERE r.request_id=p_request_id) THEN
      RAISE EXCEPTION 'legacy request collision' USING ERRCODE='22023'; END IF;
    v_snap:=ml40_r38a3_scan_trial.ml40_scan_snapshot_locked_v1(p_member_id,p_card_id,p_store_id,p_card_token);
    IF (v_snap->>'balance')::bigint IS DISTINCT FROM v_confirm.balance_before OR v_snap->>'revision' IS DISTINCT FROM v_confirm.revision_before::text
      OR v_confirm.expires_at<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'stale confirmation' USING ERRCODE='40001'; END IF;
    v_paid:=p_total-p_redeem; v_earned:=(v_paid/100)*5; v_after:=v_confirm.balance_before-p_redeem+v_earned;
    v_core:=ml40_r18_trial.process_checkout_once_checked_v2(p_request_id,p_member_id,p_store_id,p_total,p_redeem,p_card_token,NULL::uuid);
    IF v_core->'replayed' IS DISTINCT FROM 'false'::jsonb OR v_core->'paid_yen' IS DISTINCT FROM pg_catalog.to_jsonb(v_paid)
      OR v_core->'redeemed_points' IS DISTINCT FROM pg_catalog.to_jsonb(p_redeem) OR v_core->'earned_points' IS DISTINCT FROM pg_catalog.to_jsonb(v_earned)
      OR v_core->'balance_after' IS DISTINCT FROM pg_catalog.to_jsonb(v_after) THEN RAISE EXCEPTION 'checkout result mismatch' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM ml40_r18_trial.checkout_requests r WHERE r.request_id=p_request_id AND r.member_id=p_member_id AND r.staff_id=auth.uid()
      AND r.store_id=p_store_id AND r.total_yen=p_total AND r.redeemed_points=p_redeem AND r.earned_points=v_earned AND r.balance_after=v_after;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing checkout record' USING ERRCODE='22023'; END IF;
    v_expected_revision:=v_confirm.revision_before+(CASE WHEN p_redeem>0 THEN 1 ELSE 0 END)+(CASE WHEN v_earned>0 THEN 1 ELSE 0 END);
    v_final:=ml40_r38a3_scan_trial.ml40_scan_snapshot_locked_v1(p_member_id,p_card_id,p_store_id,p_card_token);
    IF (v_final->>'balance')::bigint IS DISTINCT FROM v_after OR v_final->>'revision' IS DISTINCT FROM v_expected_revision::text THEN
      RAISE EXCEPTION 'balance or revision mismatch' USING ERRCODE='40001'; END IF;
    v_result:=pg_catalog.jsonb_build_object('total',p_total,'redeem',p_redeem,'paid',v_paid,'earned',v_earned,'balance_before',v_confirm.balance_before,
      'delta',v_earned-p_redeem,'balance_after',v_after,'confirmation_id',p_confirmation_id,'revision_before',v_confirm.revision_before::text,'revision_after',v_expected_revision::text);
    INSERT INTO ml40_r38a3_scan_trial.ml40_operation_receipts_v1(request_id,actor_id,member_id,card_id,store_id,action,result,route)
      VALUES(p_request_id,auth.uid(),p_member_id,p_card_id,p_store_id,'checkout',v_result,'scan');
    UPDATE ml40_r38a3_scan_trial.ml40_checkout_confirmations_v1 SET consumed_request_id=p_request_id WHERE confirmation_id=p_confirmation_id;
  END IF;
  RETURN pg_catalog.jsonb_build_object('environment','isolated','route','scan','status','confirmed','request_id',p_request_id,'actor_id',auth.uid(),
    'member_id',p_member_id,'card_id',p_card_id,'store_id',p_store_id,'action','checkout','result',v_result);
END;
$function$;
CREATE FUNCTION ml40_r38a3_scan_trial.ml40_scan_point_once_v1(p_request_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_action text, p_expected_delta integer, p_card_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_scope uuid;
  v_old ml40_r38a3_scan_trial.ml40_operation_receipts_v1%ROWTYPE;
  v_tx uuid;
  v_result jsonb;
  v_delta integer;
  v_balance bigint;
BEGIN
  IF v_actor IS NULL OR ml40_r18_trial.is_shop_staff() IS DISTINCT FROM true THEN
    RAISE EXCEPTION '当営業日のスタッフ認証が必要です' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_member_id IS NULL OR p_card_id IS NULL OR p_store_id IS NULL
     OR p_action IS NULL OR p_action NOT IN ('visit','encounter')
     OR p_expected_delta IS NULL OR p_expected_delta <= 0
     OR (p_action = 'encounter' AND p_expected_delta <> 1) THEN
    RAISE EXCEPTION '受付情報が不正です' USING ERRCODE = '22023';
  END IF;
  IF p_action IS DISTINCT FROM 'visit' OR p_expected_delta IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'fixed trial visit' USING ERRCODE='42501'; END IF;
  v_role:=ml40_r38a3_scan_trial.ml40_scan_scope_v1(p_store_id);
  IF p_action='encounter' AND NOT EXISTS(SELECT 1 FROM ml40_r18_trial.staff_profiles sp WHERE sp.id=v_actor AND sp.encounter_points_enabled IS TRUE) THEN RAISE EXCEPTION 'encounter permission required' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ml40:' || p_request_id::text, 0));
  PERFORM ml40_r38a3_scan_trial.ml40_scan_snapshot_locked_v1(p_member_id,p_card_id,p_store_id,p_card_token);
  SELECT r.* INTO v_old FROM ml40_r38a3_scan_trial.ml40_operation_receipts_v1 r WHERE r.request_id = p_request_id;
  IF FOUND THEN
    IF v_old.route IS DISTINCT FROM 'scan' OR v_old.actor_id IS DISTINCT FROM v_actor OR v_old.member_id IS DISTINCT FROM p_member_id
       OR v_old.card_id IS DISTINCT FROM p_card_id OR v_old.store_id IS DISTINCT FROM p_store_id
       OR v_old.action IS DISTINCT FROM p_action
       OR (v_old.result -> 'delta') IS DISTINCT FROM pg_catalog.to_jsonb(p_expected_delta) THEN
      RAISE EXCEPTION '受付IDが別の操作で使用されています' USING ERRCODE = '22023';
    END IF;
    v_result := v_old.result;
  ELSE
    IF p_action='visit' THEN v_tx:=ml40_r18_trial.award_visit_point_checked_v2(p_member_id,p_store_id,p_card_token,NULL::uuid); ELSE v_tx:=ml40_r18_trial.award_encounter_point_checked_v2(p_card_token,NULL::uuid); END IF;
    SELECT t.delta INTO v_delta FROM ml40_r18_trial.point_transactions t WHERE t.id = v_tx
      AND t.member_id = p_member_id AND t.staff_id = v_actor AND t.kind = p_action
      AND ((p_action = 'visit' AND t.store_id = p_store_id) OR (p_action = 'encounter' AND t.store_id IS NULL));
    IF NOT FOUND OR v_delta IS DISTINCT FROM p_expected_delta THEN
      RAISE EXCEPTION '付与結果不一致：操作取消' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(sum(t.delta),0) INTO v_balance FROM ml40_r18_trial.point_transactions t WHERE t.member_id = p_member_id;
    IF v_balance NOT BETWEEN 0 AND 10000000 THEN
      RAISE EXCEPTION '残高が受付契約範囲外です' USING ERRCODE = '22023';
    END IF;
    v_result := pg_catalog.jsonb_build_object('transaction_id',v_tx,'delta',v_delta,'balance',v_balance);
    INSERT INTO ml40_r38a3_scan_trial.ml40_operation_receipts_v1(request_id,actor_id,member_id,card_id,store_id,action,result,route)
      VALUES(p_request_id,v_actor,p_member_id,p_card_id,p_store_id,p_action,v_result,'scan');
  END IF;
  RETURN pg_catalog.jsonb_build_object('environment','isolated','route','scan','status','confirmed',
    'request_id',p_request_id,'actor_id',v_actor,'member_id',p_member_id,'card_id',p_card_id,
    'store_id',p_store_id,'action',p_action,'result',v_result);
END;
$function$;
CREATE FUNCTION ml40_r38a3_scan_trial.ml40_scan_receipt_v1(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE r ml40_r38a3_scan_trial.ml40_operation_receipts_v1%ROWTYPE;
BEGIN
IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND u.email='ml40-r22-writer@example.invalid') OR auth.uid() IS NULL OR ml40_r18_trial.is_shop_staff() IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM ml40_r18_trial.staff_profiles sp WHERE sp.id=auth.uid() AND sp.active IS TRUE AND sp.retired_at IS NULL AND sp.role IN ('staff','store_admin','super_admin')) THEN RAISE EXCEPTION 'staff session required' USING ERRCODE='42501'; END IF;
SELECT x.* INTO r FROM ml40_r38a3_scan_trial.ml40_operation_receipts_v1 x WHERE x.request_id=p_request_id AND x.actor_id=auth.uid() AND x.route='scan';
IF NOT FOUND THEN RETURN jsonb_build_object('environment','isolated','route','scan','status','unknown'); END IF;
RETURN jsonb_build_object('environment','isolated','route','scan','status','confirmed','request_id',r.request_id,'actor_id',r.actor_id,'member_id',r.member_id,'card_id',r.card_id,'store_id',r.store_id,'action',r.action,'result',r.result);
END;$function$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ml40_r38a3_scan_trial FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ml40_r38a3_checkout_snapshot_v1(p_member_id uuid,p_card_id uuid,p_store_id uuid,p_card_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb; v_checkout boolean; v_visit boolean;
BEGIN
 d:=ml40_r38a3_scan_trial.ml40_scan_snapshot_locked_v1(p_member_id,p_card_id,p_store_id,p_card_token);
 SELECT NOT EXISTS(SELECT 1 FROM ml40_r38a3_scan_trial.ml40_operation_receipts_v1 WHERE action='checkout'), NOT EXISTS(SELECT 1 FROM ml40_r38a3_scan_trial.ml40_operation_receipts_v1 WHERE action='visit') INTO v_checkout,v_visit;
 RETURN d||jsonb_build_object('member_id',p_member_id,'card_id',p_card_id,'store_id',p_store_id,'route','scan','scan_capability',jsonb_build_object('version',1,'environment','isolated','actor_id',auth.uid(),'session_id',auth.jwt()->>'session_id','member_id',p_member_id,'card_id',p_card_id,'store_id',p_store_id,'checkout',v_checkout,'visit',v_visit,'encounter',false,'visit_delta',CASE WHEN v_visit THEN 7 ELSE 0 END));
END $$;
CREATE FUNCTION public.ml40_r38a3_checkout_confirm_v1(p_member_id uuid,p_card_id uuid,p_store_id uuid,p_total integer,p_redeem integer,p_expected_balance bigint,p_expected_revision text,p_card_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ BEGIN PERFORM RETURN ml40_r38a3_scan_trial.ml40_scan_checkout_confirm_v1(p_member_id,p_card_id,p_store_id,p_total,p_redeem,p_expected_balance,p_expected_revision,p_card_token)||jsonb_build_object('actor_id',auth.uid(),'member_id',p_member_id,'card_id',p_card_id,'store_id',p_store_id,'total',p_total,'redeem',p_redeem,'balance_before',p_expected_balance,'revision_before',p_expected_revision,'server_now',clock_timestamp()); END; $function$;
CREATE FUNCTION public.ml40_r38a3_checkout_once_v1(p_request_id uuid,p_confirmation_id uuid,p_member_id uuid,p_card_id uuid,p_store_id uuid,p_total integer,p_redeem integer,p_card_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ BEGIN RETURN ml40_r38a3_scan_trial.ml40_scan_checkout_once_v1(p_request_id,p_confirmation_id,p_member_id,p_card_id,p_store_id,p_total,p_redeem,p_card_token); END; $function$;
CREATE FUNCTION public.ml40_r38a3_point_once_v1(p_request_id uuid,p_member_id uuid,p_card_id uuid,p_store_id uuid,p_action text,p_expected_delta integer,p_card_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ BEGIN RETURN ml40_r38a3_scan_trial.ml40_scan_point_once_v1(p_request_id,p_member_id,p_card_id,p_store_id,p_action,p_expected_delta,p_card_token); END; $function$;
CREATE FUNCTION public.ml40_r38a3_receipt_v1(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ BEGIN RETURN ml40_r38a3_scan_trial.ml40_scan_receipt_v1(p_request_id); END; $function$;
REVOKE ALL ON FUNCTION public.ml40_r38a3_checkout_snapshot_v1(uuid,uuid,uuid,text),public.ml40_r38a3_checkout_confirm_v1(uuid,uuid,uuid,integer,integer,bigint,text,text),public.ml40_r38a3_checkout_once_v1(uuid,uuid,uuid,uuid,uuid,integer,integer,text),public.ml40_r38a3_point_once_v1(uuid,uuid,uuid,uuid,text,integer,text),public.ml40_r38a3_receipt_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ml40_r38a3_checkout_snapshot_v1(uuid,uuid,uuid,text),public.ml40_r38a3_checkout_confirm_v1(uuid,uuid,uuid,integer,integer,bigint,text,text),public.ml40_r38a3_checkout_once_v1(uuid,uuid,uuid,uuid,uuid,integer,integer,text),public.ml40_r38a3_point_once_v1(uuid,uuid,uuid,uuid,text,integer,text),public.ml40_r38a3_receipt_v1(uuid) TO authenticated;
COMMIT;
