-- Rollback draft for legacy function only. Coordinate with R32A/B/C rollback and receipt retention before use.
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
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '編集できる登録済みカードが見つかりません' USING ERRCODE = '42501';
  END IF;
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
