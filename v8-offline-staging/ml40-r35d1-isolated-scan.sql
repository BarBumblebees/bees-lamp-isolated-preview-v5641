-- R35D1 isolated-only scan endpoint and dedicated zero-balance fixture; synthetic marker is NOT a real card credential.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF (SELECT count(*) FROM ml40_r18_trial.members)<>2 OR (SELECT count(*) FROM ml40_r18_trial.member_card_credentials)<>2 OR (SELECT count(*) FROM ml40_r18_trial.checkout_requests)<>3 OR (SELECT count(*) FROM ml40_r18_trial.ml40_operation_receipts_v1)<>7 THEN RAISE EXCEPTION 'fixture baseline changed'; END IF;
 IF (SELECT count(*) FROM ml40_r18_trial.staff_profiles p JOIN auth.users u ON p.id=u.id WHERE u.email='ml40-r22-writer@example.invalid' AND p.active AND p.retired_at IS NULL)<>1 THEN RAISE EXCEPTION 'writer scope'; END IF;
END $guard$;
INSERT INTO ml40_r18_trial.members(id,display_name) VALUES ('18400000-0000-4000-8000-000000000013','R35D読取試験会員');
INSERT INTO ml40_r18_trial.member_card_credentials(id,member_id,issued_store_id,card_number,issued_at,issued_by,token_hash)
SELECT '18400000-0000-4000-8000-000000000023','18400000-0000-4000-8000-000000000013','18400000-0000-4000-8000-000000000002',900103,now(),u.id,extensions.digest('R35D_TEST_ONLY_XXXXXXXXXXXXXXXXXXXXXXXXXXXX','sha256') FROM auth.users u WHERE u.email='ml40-r22-writer@example.invalid';
CREATE FUNCTION public.ml40_r35d_scan_read_v1(p_card_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_card record;
  v_balance bigint;
  v_history jsonb;
BEGIN
  IF auth.uid() IS NULL OR ml40_r18_trial.is_shop_staff() IS DISTINCT FROM true
    OR NOT EXISTS(SELECT 1 FROM ml40_r18_trial.staff_profiles s WHERE s.id=auth.uid() AND s.active IS TRUE AND s.retired_at IS NULL AND s.role IN ('staff','store_admin','super_admin') AND s.id=(SELECT u.id FROM auth.users u WHERE u.email='ml40-r22-writer@example.invalid'))
  THEN RAISE EXCEPTION 'current authorized staff session required' USING ERRCODE='42501'; END IF;
  IF p_card_token IS NULL OR p_card_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN jsonb_build_object('environment','isolated','status','unknown'); END IF;
  SELECT c.id,c.member_id,c.card_number,c.revoked_at,c.replaced_by,c.issued_at,c.issued_store_id,
    m.display_name,s.name AS issued_store_name,sp.display_name AS issued_staff_name
  INTO v_card FROM ml40_r18_trial.member_card_credentials c
  LEFT JOIN ml40_r18_trial.members m ON m.id=c.member_id
  LEFT JOIN ml40_r18_trial.stores s ON s.id=c.issued_store_id
  LEFT JOIN ml40_r18_trial.staff_profiles sp ON sp.id=c.issued_by
  WHERE c.id='18400000-0000-4000-8000-000000000023'::uuid AND c.member_id='18400000-0000-4000-8000-000000000013'::uuid AND c.token_hash=extensions.digest(p_card_token,'sha256');
  IF NOT FOUND THEN RETURN jsonb_build_object('environment','isolated','status','unknown'); END IF;
  IF v_card.revoked_at IS NOT NULL OR v_card.replaced_by IS NOT NULL THEN
    RETURN jsonb_build_object('environment','isolated','status','revoked'); END IF;
  IF v_card.member_id IS NULL THEN RETURN jsonb_build_object('environment','isolated','status','prepared','card_number',lpad(v_card.card_number::text,6,'0')); END IF;
  IF v_card.display_name IS NULL THEN RETURN jsonb_build_object('environment','isolated','status','unknown'); END IF;
  SELECT coalesce(sum(t.delta),0) INTO v_balance FROM ml40_r18_trial.point_transactions t WHERE t.member_id=v_card.member_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',h.kind,'delta',h.delta,'created_at',h.created_at,'store',CASE WHEN h.kind='encounter' THEN 'スタッフ遭遇ポイント' ELSE coalesce(s.name,'不明な店舗') END,'encounter_staff_name',CASE WHEN h.kind='encounter' THEN h.encounter_staff_name ELSE NULL END) ORDER BY h.created_at DESC,h.id DESC),'[]'::jsonb)
  INTO v_history FROM (SELECT t.id,t.kind,t.delta,t.created_at,t.store_id,t.encounter_staff_name FROM ml40_r18_trial.point_transactions t WHERE t.member_id=v_card.member_id ORDER BY t.created_at DESC,t.id DESC LIMIT 20) h
  LEFT JOIN ml40_r18_trial.stores s ON s.id=h.store_id;
  RETURN jsonb_build_object('environment','isolated','status','active','route','scan',
    'actor_id',auth.uid(),'session_id',auth.jwt()->>'session_id','card_id',v_card.id,'member_id',v_card.member_id,
    'card_number',lpad(v_card.card_number::text,6,'0'),'display_name',v_card.display_name,'balance',v_balance,
    'issued_store_id',v_card.issued_store_id,'issued_store_name',v_card.issued_store_name,'issued_staff_name',v_card.issued_staff_name,'issued_at',v_card.issued_at,
    'history',v_history,'scan_write_enabled',false);
END;
$function$;
REVOKE ALL ON FUNCTION public.ml40_r35d_scan_read_v1(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ml40_r35d_scan_read_v1(text) TO authenticated;
COMMIT;
