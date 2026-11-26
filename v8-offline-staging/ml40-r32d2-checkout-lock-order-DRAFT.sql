-- R32D2 lock order correction DRAFT; requires R32A/B/C/D1. Not approved for production.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
CREATE OR REPLACE FUNCTION private.ml40_directory_checkout_once_v1(p_request_id uuid, p_confirmation_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_role text; v_old private.ml40_operation_receipts_v1%ROWTYPE;
  v_confirm private.ml40_checkout_confirmations_v1%ROWTYPE; v_snap jsonb; v_core jsonb; v_result jsonb;
  v_paid integer; v_earned integer; v_after bigint; v_final jsonb; v_expected_revision bigint;
BEGIN
  v_role:=private.ml40_checkout_scope_v1(p_store_id);
  IF p_request_id IS NULL OR p_confirmation_id IS NULL OR p_member_id IS NULL OR p_card_id IS NULL OR p_total IS NULL OR p_redeem IS NULL THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ml40:'||p_request_id::text,0));
  -- Preserve legacy request-lock -> member-lock order; deletion takes member lock before deleting confirmations.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  PERFORM 1 FROM public.members m WHERE m.id=p_member_id FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid member' USING ERRCODE='42501'; END IF;
  SELECT r.* INTO v_old FROM private.ml40_operation_receipts_v1 r WHERE r.request_id=p_request_id;
  IF FOUND THEN
    IF v_old.route IS DISTINCT FROM 'directory' OR v_old.actor_id IS DISTINCT FROM auth.uid() OR v_old.member_id IS DISTINCT FROM p_member_id OR v_old.card_id IS DISTINCT FROM p_card_id
      OR v_old.store_id IS DISTINCT FROM p_store_id OR v_old.action IS DISTINCT FROM 'checkout'
      OR v_old.result->>'confirmation_id' IS DISTINCT FROM p_confirmation_id::text
      OR v_old.result->'total' IS DISTINCT FROM pg_catalog.to_jsonb(p_total)
      OR v_old.result->'redeem' IS DISTINCT FROM pg_catalog.to_jsonb(p_redeem) THEN
      RAISE EXCEPTION 'request binding mismatch' USING ERRCODE='22023'; END IF;
    v_result:=v_old.result;
  ELSE
    SELECT c.* INTO v_confirm FROM private.ml40_checkout_confirmations_v1 c WHERE c.confirmation_id=p_confirmation_id FOR UPDATE OF c;
    IF NOT FOUND OR v_confirm.route IS DISTINCT FROM 'directory' OR v_confirm.actor_id IS DISTINCT FROM auth.uid() OR v_confirm.member_id IS DISTINCT FROM p_member_id
      OR v_confirm.card_id IS DISTINCT FROM p_card_id OR v_confirm.store_id IS DISTINCT FROM p_store_id OR v_confirm.total IS DISTINCT FROM p_total
      OR v_confirm.redeem IS DISTINCT FROM p_redeem OR v_confirm.consumed_request_id IS NOT NULL OR v_confirm.expires_at<=pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION 'invalid or expired confirmation' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.checkout_requests r WHERE r.request_id=p_request_id) THEN
      RAISE EXCEPTION 'legacy request collision' USING ERRCODE='22023'; END IF;
    v_snap:=private.ml40_checkout_snapshot_locked_v1(p_member_id,p_card_id,p_store_id,v_role);
    IF (v_snap->>'balance')::bigint IS DISTINCT FROM v_confirm.balance_before OR v_snap->>'revision' IS DISTINCT FROM v_confirm.revision_before::text
      OR v_confirm.expires_at<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'stale confirmation' USING ERRCODE='40001'; END IF;
    v_paid:=p_total-p_redeem; v_earned:=(v_paid/100)*5; v_after:=v_confirm.balance_before-p_redeem+v_earned;
    v_core:=private.manage_card_directory_points_v1(p_card_id,'checkout',p_store_id,p_request_id,p_total,p_redeem);
    IF v_core->'replayed' IS DISTINCT FROM 'false'::jsonb OR v_core->'paid_yen' IS DISTINCT FROM pg_catalog.to_jsonb(v_paid)
      OR v_core->'redeemed_points' IS DISTINCT FROM pg_catalog.to_jsonb(p_redeem) OR v_core->'earned_points' IS DISTINCT FROM pg_catalog.to_jsonb(v_earned)
      OR v_core->'balance_after' IS DISTINCT FROM pg_catalog.to_jsonb(v_after) THEN RAISE EXCEPTION 'checkout result mismatch' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.checkout_requests r WHERE r.request_id=p_request_id AND r.member_id=p_member_id AND r.staff_id=auth.uid()
      AND r.store_id=p_store_id AND r.total_yen=p_total AND r.redeemed_points=p_redeem AND r.earned_points=v_earned AND r.balance_after=v_after;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing checkout record' USING ERRCODE='22023'; END IF;
    v_expected_revision:=v_confirm.revision_before+(CASE WHEN p_redeem>0 THEN 1 ELSE 0 END)+(CASE WHEN v_earned>0 THEN 1 ELSE 0 END);
    v_final:=private.ml40_checkout_snapshot_locked_v1(p_member_id,p_card_id,p_store_id,v_role);
    IF (v_final->>'balance')::bigint IS DISTINCT FROM v_after OR v_final->>'revision' IS DISTINCT FROM v_expected_revision::text THEN
      RAISE EXCEPTION 'balance or revision mismatch' USING ERRCODE='40001'; END IF;
    v_result:=pg_catalog.jsonb_build_object('total',p_total,'redeem',p_redeem,'paid',v_paid,'earned',v_earned,'balance_before',v_confirm.balance_before,
      'delta',v_earned-p_redeem,'balance_after',v_after,'confirmation_id',p_confirmation_id,'revision_before',v_confirm.revision_before::text,'revision_after',v_expected_revision::text);
    INSERT INTO private.ml40_operation_receipts_v1(request_id,actor_id,member_id,card_id,store_id,action,result)
      VALUES(p_request_id,auth.uid(),p_member_id,p_card_id,p_store_id,'checkout',v_result);
    UPDATE private.ml40_checkout_confirmations_v1 SET consumed_request_id=p_request_id WHERE confirmation_id=p_confirmation_id;
  END IF;
  RETURN pg_catalog.jsonb_build_object('environment','production','status','confirmed','request_id',p_request_id,'actor_id',auth.uid(),
    'member_id',p_member_id,'card_id',p_card_id,'store_id',p_store_id,'action','checkout','result',v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION private.ml40_scan_checkout_once_v1(p_request_id uuid, p_confirmation_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer, p_card_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_role text; v_old private.ml40_operation_receipts_v1%ROWTYPE;
  v_confirm private.ml40_checkout_confirmations_v1%ROWTYPE; v_snap jsonb; v_core jsonb; v_result jsonb;
  v_paid integer; v_earned integer; v_after bigint; v_final jsonb; v_expected_revision bigint;
BEGIN
  v_role:=private.ml40_scan_scope_v1(p_store_id);
  IF p_request_id IS NULL OR p_confirmation_id IS NULL OR p_member_id IS NULL OR p_card_id IS NULL OR p_total IS NULL OR p_redeem IS NULL THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ml40:'||p_request_id::text,0));
  -- Preserve legacy request-lock -> member-lock order; deletion takes member lock before deleting confirmations.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  PERFORM 1 FROM public.members m WHERE m.id=p_member_id FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid member' USING ERRCODE='42501'; END IF;
  SELECT r.* INTO v_old FROM private.ml40_operation_receipts_v1 r WHERE r.request_id=p_request_id;
  IF FOUND THEN
    IF v_old.route IS DISTINCT FROM 'scan' OR v_old.actor_id IS DISTINCT FROM auth.uid() OR v_old.member_id IS DISTINCT FROM p_member_id OR v_old.card_id IS DISTINCT FROM p_card_id
      OR v_old.store_id IS DISTINCT FROM p_store_id OR v_old.action IS DISTINCT FROM 'checkout'
      OR v_old.result->>'confirmation_id' IS DISTINCT FROM p_confirmation_id::text
      OR v_old.result->'total' IS DISTINCT FROM pg_catalog.to_jsonb(p_total)
      OR v_old.result->'redeem' IS DISTINCT FROM pg_catalog.to_jsonb(p_redeem) THEN
      RAISE EXCEPTION 'request binding mismatch' USING ERRCODE='22023'; END IF;
    PERFORM private.ml40_scan_snapshot_locked_v1(p_member_id,p_card_id,p_store_id,p_card_token); v_result:=v_old.result;
  ELSE
    SELECT c.* INTO v_confirm FROM private.ml40_checkout_confirmations_v1 c WHERE c.confirmation_id=p_confirmation_id FOR UPDATE OF c;
    IF NOT FOUND OR v_confirm.route IS DISTINCT FROM 'scan' OR v_confirm.session_id IS DISTINCT FROM (auth.jwt()->>'session_id')::uuid OR v_confirm.actor_id IS DISTINCT FROM auth.uid() OR v_confirm.member_id IS DISTINCT FROM p_member_id
      OR v_confirm.card_id IS DISTINCT FROM p_card_id OR v_confirm.store_id IS DISTINCT FROM p_store_id OR v_confirm.total IS DISTINCT FROM p_total
      OR v_confirm.redeem IS DISTINCT FROM p_redeem OR v_confirm.consumed_request_id IS NOT NULL OR v_confirm.expires_at<=pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION 'invalid or expired confirmation' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.checkout_requests r WHERE r.request_id=p_request_id) THEN
      RAISE EXCEPTION 'legacy request collision' USING ERRCODE='22023'; END IF;
    v_snap:=private.ml40_scan_snapshot_locked_v1(p_member_id,p_card_id,p_store_id,p_card_token);
    IF (v_snap->>'balance')::bigint IS DISTINCT FROM v_confirm.balance_before OR v_snap->>'revision' IS DISTINCT FROM v_confirm.revision_before::text
      OR v_confirm.expires_at<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'stale confirmation' USING ERRCODE='40001'; END IF;
    v_paid:=p_total-p_redeem; v_earned:=(v_paid/100)*5; v_after:=v_confirm.balance_before-p_redeem+v_earned;
    v_core:=private.process_checkout_once_checked_v2(p_request_id,p_member_id,p_store_id,p_total,p_redeem,p_card_token,NULL::uuid);
    IF v_core->'replayed' IS DISTINCT FROM 'false'::jsonb OR v_core->'paid_yen' IS DISTINCT FROM pg_catalog.to_jsonb(v_paid)
      OR v_core->'redeemed_points' IS DISTINCT FROM pg_catalog.to_jsonb(p_redeem) OR v_core->'earned_points' IS DISTINCT FROM pg_catalog.to_jsonb(v_earned)
      OR v_core->'balance_after' IS DISTINCT FROM pg_catalog.to_jsonb(v_after) THEN RAISE EXCEPTION 'checkout result mismatch' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.checkout_requests r WHERE r.request_id=p_request_id AND r.member_id=p_member_id AND r.staff_id=auth.uid()
      AND r.store_id=p_store_id AND r.total_yen=p_total AND r.redeemed_points=p_redeem AND r.earned_points=v_earned AND r.balance_after=v_after;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing checkout record' USING ERRCODE='22023'; END IF;
    v_expected_revision:=v_confirm.revision_before+(CASE WHEN p_redeem>0 THEN 1 ELSE 0 END)+(CASE WHEN v_earned>0 THEN 1 ELSE 0 END);
    v_final:=private.ml40_scan_snapshot_locked_v1(p_member_id,p_card_id,p_store_id,p_card_token);
    IF (v_final->>'balance')::bigint IS DISTINCT FROM v_after OR v_final->>'revision' IS DISTINCT FROM v_expected_revision::text THEN
      RAISE EXCEPTION 'balance or revision mismatch' USING ERRCODE='40001'; END IF;
    v_result:=pg_catalog.jsonb_build_object('total',p_total,'redeem',p_redeem,'paid',v_paid,'earned',v_earned,'balance_before',v_confirm.balance_before,
      'delta',v_earned-p_redeem,'balance_after',v_after,'confirmation_id',p_confirmation_id,'revision_before',v_confirm.revision_before::text,'revision_after',v_expected_revision::text);
    INSERT INTO private.ml40_operation_receipts_v1(request_id,actor_id,member_id,card_id,store_id,action,result,route)
      VALUES(p_request_id,auth.uid(),p_member_id,p_card_id,p_store_id,'checkout',v_result,'scan');
    UPDATE private.ml40_checkout_confirmations_v1 SET consumed_request_id=p_request_id WHERE confirmation_id=p_confirmation_id;
  END IF;
  RETURN pg_catalog.jsonb_build_object('environment','production','route','scan','status','confirmed','request_id',p_request_id,'actor_id',auth.uid(),
    'member_id',p_member_id,'card_id',p_card_id,'store_id',p_store_id,'action','checkout','result',v_result);
END;
$function$;
COMMIT;
