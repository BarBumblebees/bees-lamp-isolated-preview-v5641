-- R32 DIRECTORY-ONLY DRAFT. NOT APPROVED FOR PRODUCTION.
-- Apply only after isolated rollback tests, schema/lock/legacy compatibility review, production approval.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';

CREATE TABLE private.ml40_balance_versions_v1(member_id uuid PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,revision bigint NOT NULL CHECK(revision>=0));
CREATE TABLE private.ml40_memo_versions_v1(member_id uuid PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,version integer NOT NULL CHECK(version>0));
CREATE TABLE private.ml40_operation_receipts_v1(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL,member_id uuid NOT NULL,card_id uuid NOT NULL,store_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('checkout','memo','visit','encounter')),result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE private.ml40_checkout_confirmations_v1(confirmation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,member_id uuid NOT NULL,card_id uuid NOT NULL,store_id uuid NOT NULL,total integer NOT NULL CHECK(total BETWEEN 1 AND 100000000),redeem integer NOT NULL CHECK(redeem>=0 AND redeem<=total AND redeem%10=0),balance_before bigint NOT NULL CHECK(balance_before BETWEEN 0 AND 10000000),revision_before bigint NOT NULL CHECK(revision_before>=0),expires_at timestamptz NOT NULL,consumed_request_id uuid UNIQUE REFERENCES private.ml40_operation_receipts_v1(request_id));


ALTER TABLE private.ml40_balance_versions_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.ml40_balance_versions_v1 FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.ml40_memo_versions_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.ml40_memo_versions_v1 FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.ml40_operation_receipts_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.ml40_operation_receipts_v1 FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.ml40_checkout_confirmations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.ml40_checkout_confirmations_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.ml40_memo_version_bump_v1(p_member uuid)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  INSERT INTO private.ml40_memo_versions_v1 AS v(member_id, version) VALUES (p_member, 1)
  ON CONFLICT (member_id) DO UPDATE SET version = v.version + 1
  RETURNING version;
$function$;
REVOKE ALL ON FUNCTION private.ml40_memo_version_bump_v1(p_member uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.ml40_memo_version_trigger_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.members m WHERE m.id = OLD.member_id) THEN
      PERFORM private.ml40_memo_version_bump_v1(OLD.member_id);
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.member_id IS DISTINCT FROM NEW.member_id THEN
    RAISE EXCEPTION 'memo member_id is immutable' USING ERRCODE='22023';
  END IF;
  PERFORM private.ml40_memo_version_bump_v1(NEW.member_id);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.ml40_memo_version_trigger_v1() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.ml40_balance_version_trigger_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_member uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.member_id IS DISTINCT FROM NEW.member_id THEN
    RAISE EXCEPTION 'point member_id is immutable' USING ERRCODE='22023';
  END IF;
  IF TG_OP = 'DELETE' THEN v_member := OLD.member_id; ELSE v_member := NEW.member_id; END IF;
  IF EXISTS (SELECT 1 FROM public.members m WHERE m.id=v_member) THEN
    INSERT INTO private.ml40_balance_versions_v1 AS v(member_id,revision) VALUES(v_member,1)
    ON CONFLICT (member_id) DO UPDATE SET revision=v.revision+1;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.ml40_balance_version_trigger_v1() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.ml40_checkout_scope_v1(p_store_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_role text; v_scope uuid;
BEGIN
  IF auth.uid() IS NULL OR public.is_shop_staff() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'staff session required' USING ERRCODE='42501'; END IF;
  SELECT sp.role,sp.default_store_id INTO v_role,v_scope FROM public.staff_profiles sp
    WHERE sp.id=auth.uid() AND sp.active IS TRUE AND sp.retired_at IS NULL FOR SHARE OF sp;
  IF NOT FOUND OR v_role IS NULL OR v_role NOT IN ('super_admin','store_admin') THEN
    RAISE EXCEPTION 'directory access required' USING ERRCODE='42501'; END IF;
  IF v_role='store_admin' THEN
    IF v_scope IS DISTINCT FROM p_store_id THEN RAISE EXCEPTION 'store scope' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM private.directory_point_grants g WHERE g.staff_id=auth.uid() AND g.store_id=v_scope FOR SHARE OF g;
    IF NOT FOUND THEN RAISE EXCEPTION 'directory grant required' USING ERRCODE='42501'; END IF;
  END IF;
  PERFORM 1 FROM public.stores s WHERE s.id=p_store_id AND s.active IS TRUE FOR SHARE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid store' USING ERRCODE='42501'; END IF;
  RETURN v_role;
END;
$function$;
REVOKE ALL ON FUNCTION private.ml40_checkout_scope_v1(p_store_id uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.ml40_checkout_snapshot_locked_v1(p_member_id uuid, p_card_id uuid, p_store_id uuid, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_revision bigint; v_balance bigint;
BEGIN
  PERFORM 1 FROM public.members m WHERE m.id=p_member_id FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid member' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM private.member_card_credentials c WHERE c.id=p_card_id AND c.member_id=p_member_id
    AND c.revoked_at IS NULL AND c.replaced_by IS NULL
    AND (p_role='super_admin' OR c.issued_store_id=p_store_id) FOR SHARE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid card binding' USING ERRCODE='42501'; END IF;
  INSERT INTO private.ml40_balance_versions_v1(member_id,revision) VALUES(p_member_id,0) ON CONFLICT (member_id) DO NOTHING;
  SELECT v.revision INTO STRICT v_revision FROM private.ml40_balance_versions_v1 v WHERE v.member_id=p_member_id FOR UPDATE OF v;
  SELECT coalesce(sum(t.delta),0) INTO v_balance FROM public.point_transactions t WHERE t.member_id=p_member_id;
  RETURN pg_catalog.jsonb_build_object('balance',v_balance,'revision',v_revision::text);
END;
$function$;
REVOKE ALL ON FUNCTION private.ml40_checkout_snapshot_locked_v1(p_member_id uuid, p_card_id uuid, p_store_id uuid, p_role text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.ml40_directory_memo_read_v1(p_card_id uuid, p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_scope uuid; v_result jsonb;
BEGIN
  v_scope := private.registered_card_store_scope();
  IF p_store_id IS NULL OR (v_scope IS NOT NULL AND v_scope IS DISTINCT FROM p_store_id)
    OR NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.id=p_store_id AND s.active IS TRUE)
    OR NOT EXISTS (SELECT 1 FROM public.staff_profiles sp WHERE sp.id=auth.uid() AND sp.active IS TRUE AND sp.retired_at IS NULL) THEN
    RAISE EXCEPTION '店舗またはスタッフ権限がありません' USING ERRCODE='42501';
  END IF;
  SELECT pg_catalog.jsonb_build_object('member_id',c.member_id,'card_id',c.id,'store_id',p_store_id,
    'memo',coalesce(n.note,''),'memo_version',coalesce(v.version,0)) INTO v_result
  FROM private.member_card_credentials c
  LEFT JOIN private.member_customer_notes n ON n.member_id=c.member_id
  LEFT JOIN private.ml40_memo_versions_v1 v ON v.member_id=c.member_id
  WHERE c.id=p_card_id AND c.member_id IS NOT NULL AND c.revoked_at IS NULL AND c.replaced_by IS NULL
    AND (v_scope IS NULL OR c.issued_store_id=v_scope);
  IF NOT FOUND THEN RAISE EXCEPTION '有効なカードが見つかりません' USING ERRCODE='42501'; END IF;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION private.ml40_directory_memo_read_v1(p_card_id uuid, p_store_id uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.ml40_directory_memo_once_v1(p_request_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_expected_version integer, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid(); v_role text; v_scope uuid;
  v_old private.ml40_operation_receipts_v1%ROWTYPE;
  v_version integer; v_hash text; v_result jsonb; v_rows bigint;
BEGIN
  IF v_actor IS NULL OR public.is_shop_staff() IS DISTINCT FROM true THEN
    RAISE EXCEPTION '当営業日の認証が必要です' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_member_id IS NULL OR p_card_id IS NULL OR p_store_id IS NULL
    OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 2147483646
    OR p_note IS NULL OR char_length(p_note)>60 OR p_note ~ '[[:cntrl:]]' OR p_note IS DISTINCT FROM btrim(p_note) THEN
    RAISE EXCEPTION 'メモ受付情報が不正です（前後の半角空白を除去してください）' USING ERRCODE='22023'; END IF;
  SELECT sp.role,sp.default_store_id INTO v_role,v_scope FROM public.staff_profiles sp
    WHERE sp.id=v_actor AND sp.active IS TRUE AND sp.retired_at IS NULL FOR SHARE OF sp;
  IF NOT FOUND OR v_role IS NULL OR v_role NOT IN ('super_admin','store_admin')
    OR (v_role='store_admin' AND v_scope IS DISTINCT FROM p_store_id) THEN
    RAISE EXCEPTION '管理者または担当店舗の権限がありません' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.stores s WHERE s.id=p_store_id AND s.active IS TRUE FOR SHARE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION '無効な店舗です' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ml40:' || p_request_id::text,0));
  PERFORM 1 FROM private.member_card_credentials c WHERE c.id=p_card_id AND c.member_id=p_member_id
    AND c.revoked_at IS NULL AND c.replaced_by IS NULL AND (v_role='super_admin' OR c.issued_store_id=v_scope) FOR SHARE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'カードと会員の照合失敗' USING ERRCODE='42501'; END IF;
  v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_note,'UTF8'),'sha256'),'hex');
  SELECT r.* INTO v_old FROM private.ml40_operation_receipts_v1 r WHERE r.request_id=p_request_id;
  IF FOUND THEN
    IF v_old.actor_id IS DISTINCT FROM v_actor OR v_old.member_id IS DISTINCT FROM p_member_id
      OR v_old.card_id IS DISTINCT FROM p_card_id OR v_old.store_id IS DISTINCT FROM p_store_id
      OR v_old.action IS DISTINCT FROM 'memo' OR (v_old.result->'memo_version') IS DISTINCT FROM pg_catalog.to_jsonb(p_expected_version+1)
      OR (v_old.result->>'note_sha256') IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION '受付IDが別の操作で使用されています' USING ERRCODE='22023'; END IF;
    v_result := v_old.result;
  ELSE
    IF p_note='' THEN
      DELETE FROM private.member_customer_notes WHERE member_id=p_member_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows=0 THEN PERFORM private.ml40_memo_version_bump_v1(p_member_id); END IF;
    ELSE
      INSERT INTO private.member_customer_notes(member_id,note) VALUES(p_member_id,p_note)
      ON CONFLICT (member_id) DO UPDATE SET note=EXCLUDED.note;
    END IF;
    SELECT v.version INTO v_version FROM private.ml40_memo_versions_v1 v WHERE v.member_id=p_member_id;
    IF v_version IS DISTINCT FROM p_expected_version+1 THEN
      RAISE EXCEPTION 'memo_conflict_or_invalid' USING ERRCODE='40001'; END IF;
    v_result := pg_catalog.jsonb_build_object('memo_version',v_version,'note_sha256',v_hash);
    INSERT INTO private.ml40_operation_receipts_v1(request_id,actor_id,member_id,card_id,store_id,action,result)
      VALUES(p_request_id,v_actor,p_member_id,p_card_id,p_store_id,'memo',v_result);
  END IF;
  RETURN pg_catalog.jsonb_build_object('environment','production','status','confirmed','request_id',p_request_id,
    'actor_id',v_actor,'member_id',p_member_id,'card_id',p_card_id,'store_id',p_store_id,'action','memo','result',v_result);
END;
$function$;
REVOKE ALL ON FUNCTION private.ml40_directory_memo_once_v1(p_request_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_expected_version integer, p_note text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.ml40_directory_point_once_v1(p_request_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_action text, p_expected_delta integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_scope uuid;
  v_old private.ml40_operation_receipts_v1%ROWTYPE;
  v_tx uuid;
  v_result jsonb;
  v_delta integer;
  v_balance bigint;
BEGIN
  IF v_actor IS NULL OR public.is_shop_staff() IS DISTINCT FROM true THEN
    RAISE EXCEPTION '当営業日のスタッフ認証が必要です' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_member_id IS NULL OR p_card_id IS NULL OR p_store_id IS NULL
     OR p_action IS NULL OR p_action NOT IN ('visit','encounter')
     OR p_expected_delta IS NULL OR p_expected_delta <= 0
     OR (p_action = 'encounter' AND p_expected_delta <> 1) THEN
    RAISE EXCEPTION '受付情報が不正です' USING ERRCODE = '22023';
  END IF;
  SELECT sp.role, sp.default_store_id INTO v_role, v_scope
  FROM public.staff_profiles sp WHERE sp.id = v_actor AND sp.active IS TRUE
    AND sp.retired_at IS NULL FOR SHARE OF sp;
  IF NOT FOUND OR v_role IS NULL OR v_role NOT IN ('super_admin','store_admin') THEN
    RAISE EXCEPTION '一覧操作権限がありません' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'store_admin' THEN
    IF v_scope IS DISTINCT FROM p_store_id THEN
      RAISE EXCEPTION '担当店舗のみ操作できます' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM private.directory_point_grants g
      JOIN public.stores s ON s.id = g.store_id AND s.active IS TRUE
      WHERE g.staff_id = v_actor AND g.store_id = v_scope FOR SHARE OF g, s;
    IF NOT FOUND THEN RAISE EXCEPTION '一覧操作権限がありません' USING ERRCODE = '42501'; END IF;
  END IF;
  PERFORM 1 FROM public.stores s WHERE s.id = p_store_id AND s.active IS TRUE FOR SHARE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION '無効な店舗です' USING ERRCODE = '42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ml40:' || p_request_id::text, 0));
  SELECT r.* INTO v_old FROM private.ml40_operation_receipts_v1 r WHERE r.request_id = p_request_id;
  IF FOUND THEN
    IF v_old.actor_id IS DISTINCT FROM v_actor OR v_old.member_id IS DISTINCT FROM p_member_id
       OR v_old.card_id IS DISTINCT FROM p_card_id OR v_old.store_id IS DISTINCT FROM p_store_id
       OR v_old.action IS DISTINCT FROM p_action
       OR (v_old.result -> 'delta') IS DISTINCT FROM pg_catalog.to_jsonb(p_expected_delta) THEN
      RAISE EXCEPTION '受付IDが別の操作で使用されています' USING ERRCODE = '22023';
    END IF;
    v_result := v_old.result;
  ELSE
    PERFORM 1 FROM private.member_card_credentials c WHERE c.id = p_card_id
      AND c.member_id = p_member_id AND c.revoked_at IS NULL AND c.replaced_by IS NULL
      AND (v_role = 'super_admin' OR c.issued_store_id = v_scope);
    IF NOT FOUND THEN RAISE EXCEPTION '有効なカードと会員が一致しません' USING ERRCODE = '42501'; END IF;
    v_tx := (private.manage_card_directory_points_v1(p_card_id,p_action,p_store_id,NULL::uuid,NULL::integer,NULL::integer) #>> '{}')::uuid;
    SELECT t.delta INTO v_delta FROM public.point_transactions t WHERE t.id = v_tx
      AND t.member_id = p_member_id AND t.staff_id = v_actor AND t.kind = p_action
      AND ((p_action = 'visit' AND t.store_id = p_store_id) OR (p_action = 'encounter' AND t.store_id IS NULL));
    IF NOT FOUND OR v_delta IS DISTINCT FROM p_expected_delta THEN
      RAISE EXCEPTION '付与結果不一致：操作取消' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(sum(t.delta),0) INTO v_balance FROM public.point_transactions t WHERE t.member_id = p_member_id;
    IF v_balance NOT BETWEEN 0 AND 10000000 THEN
      RAISE EXCEPTION '残高が受付契約範囲外です' USING ERRCODE = '22023';
    END IF;
    v_result := pg_catalog.jsonb_build_object('transaction_id',v_tx,'delta',v_delta,'balance',v_balance);
    INSERT INTO private.ml40_operation_receipts_v1(request_id,actor_id,member_id,card_id,store_id,action,result)
      VALUES(p_request_id,v_actor,p_member_id,p_card_id,p_store_id,p_action,v_result);
  END IF;
  RETURN pg_catalog.jsonb_build_object('environment','production','status','confirmed',
    'request_id',p_request_id,'actor_id',v_actor,'member_id',p_member_id,'card_id',p_card_id,
    'store_id',p_store_id,'action',p_action,'result',v_result);
END;
$function$;
REVOKE ALL ON FUNCTION private.ml40_directory_point_once_v1(p_request_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_action text, p_expected_delta integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.ml40_directory_checkout_confirm_v1(p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer, p_expected_balance bigint, p_expected_revision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_role text; v_snap jsonb; v_id uuid; v_expires timestamptz; v_after bigint;
BEGIN
  v_role:=private.ml40_checkout_scope_v1(p_store_id);
  IF p_total IS NULL OR p_total NOT BETWEEN 1 AND 100000000 OR p_redeem IS NULL OR p_redeem<0
    OR p_redeem>p_total OR p_redeem%10<>0 OR p_expected_balance IS NULL OR p_expected_balance NOT BETWEEN 0 AND 10000000
    OR p_redeem>p_expected_balance OR p_expected_revision IS NULL OR p_expected_revision !~ '^(0|[1-9][0-9]{0,18})$' THEN
    RAISE EXCEPTION 'invalid preview' USING ERRCODE='22023'; END IF;
  v_after:=p_expected_balance-p_redeem+((p_total-p_redeem)/100)*5;
  IF v_after NOT BETWEEN 0 AND 10000000 THEN RAISE EXCEPTION 'balance range' USING ERRCODE='22023'; END IF;
  v_snap:=private.ml40_checkout_snapshot_locked_v1(p_member_id,p_card_id,p_store_id,v_role);
  IF (v_snap->>'balance')::bigint IS DISTINCT FROM p_expected_balance OR v_snap->>'revision' IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale preview' USING ERRCODE='40001'; END IF;
  v_expires:=pg_catalog.clock_timestamp()+interval '2 minutes';
  INSERT INTO private.ml40_checkout_confirmations_v1(actor_id,member_id,card_id,store_id,total,redeem,balance_before,revision_before,expires_at)
    VALUES(auth.uid(),p_member_id,p_card_id,p_store_id,p_total,p_redeem,p_expected_balance,p_expected_revision::bigint,v_expires)
    RETURNING confirmation_id INTO v_id;
  RETURN pg_catalog.jsonb_build_object('environment','production','status','issued','confirmation_id',v_id,'expires_at',v_expires);
END;
$function$;
REVOKE ALL ON FUNCTION private.ml40_directory_checkout_confirm_v1(p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer, p_expected_balance bigint, p_expected_revision text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.ml40_directory_checkout_once_v1(p_request_id uuid, p_confirmation_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer)
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
  SELECT r.* INTO v_old FROM private.ml40_operation_receipts_v1 r WHERE r.request_id=p_request_id;
  IF FOUND THEN
    IF v_old.actor_id IS DISTINCT FROM auth.uid() OR v_old.member_id IS DISTINCT FROM p_member_id OR v_old.card_id IS DISTINCT FROM p_card_id
      OR v_old.store_id IS DISTINCT FROM p_store_id OR v_old.action IS DISTINCT FROM 'checkout'
      OR v_old.result->>'confirmation_id' IS DISTINCT FROM p_confirmation_id::text
      OR v_old.result->'total' IS DISTINCT FROM pg_catalog.to_jsonb(p_total)
      OR v_old.result->'redeem' IS DISTINCT FROM pg_catalog.to_jsonb(p_redeem) THEN
      RAISE EXCEPTION 'request binding mismatch' USING ERRCODE='22023'; END IF;
    v_result:=v_old.result;
  ELSE
    SELECT c.* INTO v_confirm FROM private.ml40_checkout_confirmations_v1 c WHERE c.confirmation_id=p_confirmation_id FOR UPDATE OF c;
    IF NOT FOUND OR v_confirm.actor_id IS DISTINCT FROM auth.uid() OR v_confirm.member_id IS DISTINCT FROM p_member_id
      OR v_confirm.card_id IS DISTINCT FROM p_card_id OR v_confirm.store_id IS DISTINCT FROM p_store_id OR v_confirm.total IS DISTINCT FROM p_total
      OR v_confirm.redeem IS DISTINCT FROM p_redeem OR v_confirm.consumed_request_id IS NOT NULL OR v_confirm.expires_at<=pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION 'invalid or expired confirmation' USING ERRCODE='22023'; END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
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
REVOKE ALL ON FUNCTION private.ml40_directory_checkout_once_v1(p_request_id uuid, p_confirmation_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.ml40_operation_receipt_v1(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_receipt private.ml40_operation_receipts_v1%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR public.is_shop_staff() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'スタッフとして当営業日にログインしてください' USING ERRCODE = '42501';
  END IF;
  SELECT r.* INTO v_receipt FROM private.ml40_operation_receipts_v1 r
  JOIN public.staff_profiles sp ON sp.id = r.actor_id
  JOIN public.stores s ON s.id = r.store_id AND s.active IS TRUE
  WHERE r.request_id = p_request_id AND r.actor_id = v_actor
    AND sp.active IS TRUE AND sp.retired_at IS NULL
    AND (sp.role = 'super_admin' OR (sp.role IN ('store_admin','staff') AND sp.default_store_id = r.store_id))
    AND (r.action <> 'memo' OR sp.role IN ('super_admin','store_admin'))
    AND (r.action NOT IN ('visit','encounter','checkout') OR private.staff_directory_points_access_v1() IS TRUE); 
  IF NOT FOUND THEN RETURN jsonb_build_object('environment','production','status','unknown'); END IF;
  RETURN jsonb_build_object('environment','production','status','confirmed',
    'request_id',v_receipt.request_id,'actor_id',v_receipt.actor_id,
    'member_id',v_receipt.member_id,'card_id',v_receipt.card_id,'store_id',v_receipt.store_id,
    'action',v_receipt.action,'result',v_receipt.result);
END;
$function$;
REVOKE ALL ON FUNCTION private.ml40_operation_receipt_v1(p_request_id uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER ml40_r32_balance_version AFTER INSERT OR UPDATE OR DELETE ON public.point_transactions FOR EACH ROW EXECUTE FUNCTION private.ml40_balance_version_trigger_v1();
CREATE TRIGGER ml40_r32_memo_version AFTER INSERT OR UPDATE OR DELETE ON private.member_customer_notes FOR EACH ROW EXECUTE FUNCTION private.ml40_memo_version_trigger_v1();

CREATE FUNCTION public.ml40_api_list_registered_cards_v2(p_query text, p_kind text, p_offset integer, p_status text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ DECLARE d jsonb; can_operate boolean; BEGIN IF auth.uid() IS NULL OR public.is_shop_staff() IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=auth.uid() AND active IS TRUE AND retired_at IS NULL) THEN RAISE EXCEPTION 'current authorized staff session required' USING ERRCODE='42501'; END IF; d:=private.list_registered_cards_v2(p_query,p_kind,p_offset,p_status); can_operate:=private.staff_directory_points_access_v1() IS TRUE; IF NOT can_operate THEN d:=jsonb_set(d,'{cards}',(SELECT coalesce(jsonb_agg(jsonb_set(e.value,'{customer_note}','""'::jsonb,true) ORDER BY e.ordinality),'[]'::jsonb) FROM jsonb_array_elements(d->'cards') WITH ORDINALITY AS e(value,ordinality)),false); END IF; RETURN d||jsonb_build_object('capabilities',jsonb_build_object('detail',can_operate,'write',can_operate)); END; $function$;
REVOKE ALL ON FUNCTION public.ml40_api_list_registered_cards_v2(p_query text, p_kind text, p_offset integer, p_status text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ml40_api_list_registered_cards_v2(p_query text, p_kind text, p_offset integer, p_status text) TO authenticated;

CREATE FUNCTION public.ml40_api_directory_checkout_confirm_v1(p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer, p_expected_balance bigint, p_expected_revision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ DECLARE v_result jsonb; BEGIN IF auth.uid() IS NULL OR public.is_shop_staff() IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=auth.uid() AND active IS TRUE AND retired_at IS NULL) THEN RAISE EXCEPTION 'current authorized staff session required' USING ERRCODE='42501'; END IF; IF private.staff_directory_points_access_v1() IS DISTINCT FROM true THEN RAISE EXCEPTION 'directory operation permission required' USING ERRCODE='42501'; END IF; v_result := private.ml40_directory_checkout_confirm_v1(p_member_id,p_card_id,p_store_id,p_total,p_redeem,p_expected_balance,p_expected_revision) || pg_catalog.jsonb_build_object('actor_id',auth.uid(),'member_id',p_member_id,'card_id',p_card_id,'store_id',p_store_id,'total',p_total,'redeem',p_redeem,'balance_before',p_expected_balance,'revision_before',p_expected_revision); RETURN v_result || pg_catalog.jsonb_build_object('server_now',pg_catalog.clock_timestamp()); END; $function$;
REVOKE ALL ON FUNCTION public.ml40_api_directory_checkout_confirm_v1(p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer, p_expected_balance bigint, p_expected_revision text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ml40_api_directory_checkout_confirm_v1(p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer, p_expected_balance bigint, p_expected_revision text) TO authenticated;

CREATE FUNCTION public.ml40_api_directory_checkout_once_v1(p_request_id uuid, p_confirmation_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ BEGIN IF auth.uid() IS NULL OR public.is_shop_staff() IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=auth.uid() AND active IS TRUE AND retired_at IS NULL) THEN RAISE EXCEPTION 'current authorized staff session required' USING ERRCODE='42501'; END IF; IF private.staff_directory_points_access_v1() IS DISTINCT FROM true THEN RAISE EXCEPTION 'directory operation permission required' USING ERRCODE='42501'; END IF; RETURN private.ml40_directory_checkout_once_v1(p_request_id,p_confirmation_id,p_member_id,p_card_id,p_store_id,p_total,p_redeem); END; $function$;
REVOKE ALL ON FUNCTION public.ml40_api_directory_checkout_once_v1(p_request_id uuid, p_confirmation_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ml40_api_directory_checkout_once_v1(p_request_id uuid, p_confirmation_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_total integer, p_redeem integer) TO authenticated;

CREATE FUNCTION public.ml40_api_directory_checkout_snapshot_v1(p_member_id uuid, p_card_id uuid, p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ DECLARE v_role text; v_result jsonb; BEGIN IF auth.uid() IS NULL OR public.is_shop_staff() IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=auth.uid() AND active IS TRUE AND retired_at IS NULL) THEN RAISE EXCEPTION 'current authorized staff session required' USING ERRCODE='42501'; END IF; IF private.staff_directory_points_access_v1() IS DISTINCT FROM true THEN RAISE EXCEPTION 'directory operation permission required' USING ERRCODE='42501'; END IF; v_role:=private.ml40_checkout_scope_v1(p_store_id); SELECT pg_catalog.jsonb_build_object('member_id',c.member_id,'card_id',c.id,'store_id',p_store_id,'balance',(SELECT coalesce(sum(t.delta),0) FROM public.point_transactions t WHERE t.member_id=c.member_id),'revision',coalesce(v.revision,0)::text) INTO v_result FROM private.member_card_credentials c JOIN public.members m ON m.id=c.member_id LEFT JOIN private.ml40_balance_versions_v1 v ON v.member_id=c.member_id WHERE c.id=p_card_id AND c.member_id=p_member_id AND c.revoked_at IS NULL AND c.replaced_by IS NULL AND (v_role='super_admin' OR c.issued_store_id=p_store_id); IF NOT FOUND THEN RAISE EXCEPTION 'invalid card binding' USING ERRCODE='42501'; END IF; RETURN v_result; END; $function$;
REVOKE ALL ON FUNCTION public.ml40_api_directory_checkout_snapshot_v1(p_member_id uuid, p_card_id uuid, p_store_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ml40_api_directory_checkout_snapshot_v1(p_member_id uuid, p_card_id uuid, p_store_id uuid) TO authenticated;

CREATE FUNCTION public.ml40_api_directory_memo_once_v1(p_request_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_expected_version integer, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ BEGIN IF auth.uid() IS NULL OR public.is_shop_staff() IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=auth.uid() AND active IS TRUE AND retired_at IS NULL) THEN RAISE EXCEPTION 'current authorized staff session required' USING ERRCODE='42501'; END IF; IF private.staff_directory_points_access_v1() IS DISTINCT FROM true THEN RAISE EXCEPTION 'directory operation permission required' USING ERRCODE='42501'; END IF; PERFORM private.ml40_checkout_scope_v1(p_store_id); RETURN private.ml40_directory_memo_once_v1(p_request_id,p_member_id,p_card_id,p_store_id,p_expected_version,p_note); END; $function$;
REVOKE ALL ON FUNCTION public.ml40_api_directory_memo_once_v1(p_request_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_expected_version integer, p_note text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ml40_api_directory_memo_once_v1(p_request_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_expected_version integer, p_note text) TO authenticated;

CREATE FUNCTION public.ml40_api_directory_memo_read_v1(p_card_id uuid, p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ BEGIN IF auth.uid() IS NULL OR public.is_shop_staff() IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=auth.uid() AND active IS TRUE AND retired_at IS NULL) THEN RAISE EXCEPTION 'current authorized staff session required' USING ERRCODE='42501'; END IF; IF private.staff_directory_points_access_v1() IS DISTINCT FROM true THEN RAISE EXCEPTION 'directory operation permission required' USING ERRCODE='42501'; END IF; RETURN private.ml40_directory_memo_read_v1(p_card_id,p_store_id); END; $function$;
REVOKE ALL ON FUNCTION public.ml40_api_directory_memo_read_v1(p_card_id uuid, p_store_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ml40_api_directory_memo_read_v1(p_card_id uuid, p_store_id uuid) TO authenticated;

CREATE FUNCTION public.ml40_api_directory_point_once_v1(p_request_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_action text, p_expected_delta integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ BEGIN IF auth.uid() IS NULL OR public.is_shop_staff() IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=auth.uid() AND active IS TRUE AND retired_at IS NULL) THEN RAISE EXCEPTION 'current authorized staff session required' USING ERRCODE='42501'; END IF; IF private.staff_directory_points_access_v1() IS DISTINCT FROM true THEN RAISE EXCEPTION 'directory operation permission required' USING ERRCODE='42501'; END IF; RETURN private.ml40_directory_point_once_v1(p_request_id,p_member_id,p_card_id,p_store_id,p_action,p_expected_delta); END; $function$;
REVOKE ALL ON FUNCTION public.ml40_api_directory_point_once_v1(p_request_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_action text, p_expected_delta integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ml40_api_directory_point_once_v1(p_request_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_action text, p_expected_delta integer) TO authenticated;

CREATE FUNCTION public.ml40_operation_receipt_v1(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ BEGIN IF auth.uid() IS NULL OR public.is_shop_staff() IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=auth.uid() AND active IS TRUE AND retired_at IS NULL) THEN RAISE EXCEPTION 'current authorized staff session required' USING ERRCODE='42501'; END IF; IF private.staff_directory_points_access_v1() IS DISTINCT FROM true THEN RAISE EXCEPTION 'directory operation permission required' USING ERRCODE='42501'; END IF; RETURN private.ml40_operation_receipt_v1(p_request_id); END; $function$;
REVOKE ALL ON FUNCTION public.ml40_operation_receipt_v1(p_request_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ml40_operation_receipt_v1(p_request_id uuid) TO authenticated;

CREATE FUNCTION public.ml40_api_registered_card_activity_v2(p_card_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ BEGIN IF auth.uid() IS NULL OR public.is_shop_staff() IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=auth.uid() AND active IS TRUE AND retired_at IS NULL) THEN RAISE EXCEPTION 'current authorized staff session required' USING ERRCODE='42501'; END IF; IF private.staff_directory_points_access_v1() IS DISTINCT FROM true THEN RAISE EXCEPTION 'directory operation permission required' USING ERRCODE='42501'; END IF; RETURN private.registered_card_activity_v2(p_card_id); END; $function$;
REVOKE ALL ON FUNCTION public.ml40_api_registered_card_activity_v2(p_card_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ml40_api_registered_card_activity_v2(p_card_id uuid) TO authenticated;
COMMIT;
