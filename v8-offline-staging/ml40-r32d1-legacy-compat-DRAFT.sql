-- R32D1 DRAFT; requires R32A/B/C. No production application.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.save_registered_card_note_v1(uuid,text)'::regprocedure)) IS DISTINCT FROM '0a35f4843452183d578d68b6958ef58f' THEN RAISE EXCEPTION 'legacy memo source changed; re-review required'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION private.ml40_directory_memo_once_v1(p_request_id uuid, p_member_id uuid, p_card_id uuid, p_store_id uuid, p_expected_version integer, p_note text)
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
  PERFORM 1 FROM public.members m WHERE m.id=p_member_id FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid member' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM private.member_card_credentials c WHERE c.id=p_card_id AND c.member_id=p_member_id
    AND c.revoked_at IS NULL AND c.replaced_by IS NULL AND (v_role='super_admin' OR c.issued_store_id=v_scope) FOR SHARE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'カードと会員の照合失敗' USING ERRCODE='42501'; END IF;
  v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_note,'UTF8'),'sha256'),'hex');
  SELECT r.* INTO v_old FROM private.ml40_operation_receipts_v1 r WHERE r.request_id=p_request_id;
  IF FOUND THEN
    IF v_old.route IS DISTINCT FROM 'directory' OR v_old.actor_id IS DISTINCT FROM v_actor OR v_old.member_id IS DISTINCT FROM p_member_id
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
CREATE OR REPLACE FUNCTION public.save_registered_card_note_v1(p_card_id uuid, p_note text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_store uuid := private.registered_card_store_scope();
  v_member uuid;
  v_note text := btrim(coalesce(p_note, ''));
BEGIN
  SELECT c.member_id INTO v_member
  FROM private.member_card_credentials c
  WHERE c.id = p_card_id AND c.member_id IS NOT NULL AND c.revoked_at IS NULL
    AND (v_store IS NULL OR c.issued_store_id = v_store)
  ;
  IF NOT FOUND THEN
    RAISE EXCEPTION '編集できる登録済みカードが見つかりません' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.members m WHERE m.id=v_member FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION '編集できる登録済みカードが見つかりません' USING ERRCODE='42501'; END IF;
  v_store := private.registered_card_store_scope();
  PERFORM 1 FROM private.member_card_credentials c WHERE c.id=p_card_id AND c.member_id=v_member AND c.revoked_at IS NULL
    AND (v_store IS NULL OR c.issued_store_id=v_store) FOR SHARE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION '編集できる登録済みカードが見つかりません' USING ERRCODE='42501'; END IF;
  IF char_length(v_note) > 60 OR v_note ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'メモは改行なしの60文字以内で入力してください' USING ERRCODE = '22023';
  END IF;
  IF v_note = '' THEN
    DELETE FROM private.member_customer_notes WHERE member_id = v_member;
  ELSE
    INSERT INTO private.member_customer_notes(member_id, note) VALUES (v_member, v_note)
    ON CONFLICT (member_id) DO UPDATE SET note = EXCLUDED.note;
  END IF;
  RETURN v_note;
END;
$function$;
CREATE FUNCTION private.ml40_member_cleanup_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 DELETE FROM private.ml40_checkout_confirmations_v1 WHERE member_id=OLD.id;
 DELETE FROM private.ml40_operation_receipts_v1 WHERE member_id=OLD.id;
 RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION private.ml40_member_cleanup_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ml40_r32_member_cleanup BEFORE DELETE ON public.members FOR EACH ROW EXECUTE FUNCTION private.ml40_member_cleanup_v1();
COMMIT;
