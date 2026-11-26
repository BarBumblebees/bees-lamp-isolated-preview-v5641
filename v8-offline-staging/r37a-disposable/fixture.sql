-- disposable synthetic PostgreSQL only, no external connections or live records
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE SCHEMA fixture;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL,created_at timestamptz NOT NULL);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO authenticated;
CREATE TABLE fixture.checkout_requests (request_id uuid NOT NULL,member_id uuid,store_id uuid,staff_id uuid,total_yen integer,redeemed_points integer,earned_points integer,balance_after bigint);
CREATE TABLE fixture.directory_point_grants (staff_id uuid NOT NULL,store_id uuid NOT NULL);
CREATE TABLE fixture.member_card_credentials (id uuid NOT NULL,member_id uuid,issued_store_id uuid,revoked_at timestamp with time zone,replaced_by uuid,token_hash bytea,card_number integer,issued_at timestamp with time zone,issued_by uuid);
CREATE TABLE fixture.member_customer_notes (member_id uuid NOT NULL,note text NOT NULL);
CREATE TABLE fixture.members (id uuid NOT NULL,display_name text NOT NULL,created_at timestamp with time zone DEFAULT now());
CREATE TABLE fixture.point_transactions (id uuid DEFAULT gen_random_uuid() NOT NULL,member_id uuid NOT NULL,store_id uuid,staff_id uuid,kind text NOT NULL,delta integer NOT NULL,visit_date date,encounter_business_date date,encounter_staff_name text,created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE fixture.staff_profiles (id uuid NOT NULL,role text NOT NULL,default_store_id uuid,active boolean NOT NULL,retired_at timestamp with time zone,display_name text NOT NULL,encounter_public_name text,encounter_points_enabled boolean DEFAULT false NOT NULL);
CREATE TABLE fixture.stores (id uuid NOT NULL,name text NOT NULL,active boolean NOT NULL,visit_points integer NOT NULL);
ALTER TABLE fixture.checkout_requests ADD PRIMARY KEY (request_id);
ALTER TABLE fixture.directory_point_grants ADD PRIMARY KEY (staff_id, store_id);
ALTER TABLE fixture.member_card_credentials ADD PRIMARY KEY (id);
ALTER TABLE fixture.member_card_credentials ADD UNIQUE (token_hash);
ALTER TABLE fixture.member_customer_notes ADD PRIMARY KEY (member_id);
ALTER TABLE fixture.members ADD PRIMARY KEY (id);
ALTER TABLE fixture.point_transactions ADD PRIMARY KEY (id);
ALTER TABLE fixture.staff_profiles ADD PRIMARY KEY (id);
ALTER TABLE fixture.staff_profiles ADD CHECK ((role = ANY (ARRAY['super_admin'::text, 'store_admin'::text, 'staff'::text])));
ALTER TABLE fixture.stores ADD PRIMARY KEY (id);
ALTER TABLE fixture.stores ADD CHECK ((visit_points > 0));
ALTER TABLE fixture.checkout_requests ADD FOREIGN KEY (member_id) REFERENCES fixture.members(id);
ALTER TABLE fixture.checkout_requests ADD FOREIGN KEY (staff_id) REFERENCES fixture.staff_profiles(id);
ALTER TABLE fixture.checkout_requests ADD FOREIGN KEY (store_id) REFERENCES fixture.stores(id);
ALTER TABLE fixture.directory_point_grants ADD FOREIGN KEY (staff_id) REFERENCES fixture.staff_profiles(id);
ALTER TABLE fixture.directory_point_grants ADD FOREIGN KEY (store_id) REFERENCES fixture.stores(id);
ALTER TABLE fixture.member_card_credentials ADD FOREIGN KEY (issued_by) REFERENCES fixture.staff_profiles(id);
ALTER TABLE fixture.member_card_credentials ADD FOREIGN KEY (issued_store_id) REFERENCES fixture.stores(id);
ALTER TABLE fixture.member_card_credentials ADD FOREIGN KEY (member_id) REFERENCES fixture.members(id);
ALTER TABLE fixture.member_customer_notes ADD FOREIGN KEY (member_id) REFERENCES fixture.members(id);

ALTER TABLE fixture.point_transactions ADD FOREIGN KEY (member_id) REFERENCES fixture.members(id);
ALTER TABLE fixture.point_transactions ADD FOREIGN KEY (staff_id) REFERENCES fixture.staff_profiles(id);
ALTER TABLE fixture.point_transactions ADD FOREIGN KEY (store_id) REFERENCES fixture.stores(id);
ALTER TABLE fixture.staff_profiles ADD FOREIGN KEY (default_store_id) REFERENCES fixture.stores(id);

SET check_function_bodies=off;
CREATE OR REPLACE FUNCTION fixture.award_encounter_point_checked_v2(p_card_token text, p_directory_card_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_staff_id uuid := auth.uid();
  v_staff_name text;
  v_member_id uuid;
  v_business_day date := ((pg_catalog.now() AT TIME ZONE 'Asia/Tokyo') - INTERVAL '8 hours')::date;
  v_tx_id uuid;
BEGIN
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'スタッフとしてログインしてください' USING ERRCODE='42501';
  END IF;

  SELECT COALESCE(sp.encounter_public_name,sp.display_name) INTO v_staff_name
  FROM fixture.staff_profiles sp
  WHERE sp.id = v_staff_id AND sp.encounter_points_enabled IS TRUE AND sp.active IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '遭遇ポイント付与権限がありません' USING ERRCODE='42501';
  END IF;

  IF NOT fixture.is_staff_business_session_current() THEN
    RAISE EXCEPTION '営業日が切り替わりました。再ログインしてください' USING ERRCODE='42501';
  END IF;

  IF p_directory_card_id IS NULL AND (p_card_token IS NULL OR p_card_token !~ '^[a-zA-Z0-9_-]{43}$') THEN
    RAISE EXCEPTION 'カード情報を確認してください' USING ERRCODE='22023';
  END IF;

  SELECT m.id INTO v_member_id
  FROM fixture.member_card_credentials c
  JOIN fixture.members m ON m.id = c.member_id
  WHERE (CASE WHEN p_directory_card_id IS NULL
      THEN c.token_hash = extensions.digest(p_card_token,'sha256')
      ELSE c.id = p_directory_card_id AND c.replaced_by IS NULL
    END)
    AND c.revoked_at IS NULL
  FOR UPDATE OF m;

  IF NOT FOUND THEN
    RAISE EXCEPTION '有効な会員カードが見つかりません' USING ERRCODE='22023';
  END IF;

  IF p_directory_card_id IS NULL THEN
    PERFORM fixture.require_current_point_card(v_member_id, p_card_token);
  ELSE
    PERFORM fixture.require_directory_point_card(p_directory_card_id, v_member_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM fixture.point_transactions t
    WHERE t.member_id = v_member_id
      AND t.staff_id = v_staff_id
      AND t.kind = 'encounter'
      AND t.encounter_business_date = v_business_day
  ) THEN
    RAISE EXCEPTION 'このスタッフからの遭遇ポイントは当営業日に付与済みです'
      USING ERRCODE='23505';
  END IF;

  INSERT INTO fixture.point_transactions
    (member_id, store_id, staff_id, kind, delta,
     encounter_business_date, encounter_staff_name)
  VALUES
    (v_member_id, NULL, v_staff_id, 'encounter', 1,
     v_business_day, v_staff_name)
  RETURNING id INTO v_tx_id;

  RETURN v_tx_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION fixture.award_visit_point_checked_v2(p_member_id uuid, p_store_id uuid, p_card_token text, p_directory_card_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_staff_id uuid := auth.uid();
  v_visit_date date :=
    (
      (now() AT TIME ZONE 'Asia/Tokyo')
      - INTERVAL '8 hours'
    )::date;
  v_visit_points integer;
  v_transaction_id uuid;
BEGIN
  IF v_staff_id IS NULL
     OR NOT fixture.is_shop_staff() THEN
    RAISE EXCEPTION 'スタッフ権限がありません';
  END IF;

  IF NOT fixture.is_staff_business_session_current() THEN
    RAISE EXCEPTION '営業日が切り替わったため再ログインしてください';
  END IF;

  SELECT visit_points
  INTO v_visit_points
  FROM fixture.stores
  WHERE id = p_store_id
    AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION '有効な店舗ではありません';
  END IF;

  IF v_visit_points IS NULL
     OR v_visit_points <= 0 THEN
    RAISE EXCEPTION '店舗のポイント設定が不正です';
  END IF;

  PERFORM 1
  FROM fixture.members
  WHERE id = p_member_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '会員が見つかりません' USING ERRCODE = 'BC001';
  END IF;

  IF p_directory_card_id IS NULL THEN
    PERFORM fixture.require_current_point_card(p_member_id, p_card_token);
  ELSE
    PERFORM fixture.require_directory_point_card(p_directory_card_id, p_member_id);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM fixture.point_transactions
    WHERE member_id = p_member_id
      AND store_id = p_store_id
      AND kind = 'visit'
      AND visit_date = v_visit_date
  ) THEN
    RAISE EXCEPTION
      'この営業日の来店ポイントは付与済みです';
  END IF;

  INSERT INTO fixture.point_transactions (
    member_id,
    store_id,
    staff_id,
    kind,
    delta,
    visit_date
  )
  VALUES (
    p_member_id,
    p_store_id,
    v_staff_id,
    'visit',
    v_visit_points,
    v_visit_date
  )
  RETURNING id INTO v_transaction_id;

  RETURN v_transaction_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION fixture.is_shop_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT auth.uid() IS NOT NULL
   AND EXISTS (
      SELECT 1 FROM fixture.staff_profiles sp
       WHERE sp.id = auth.uid()
         AND sp.active IS TRUE
   )
   AND fixture.is_staff_business_session_current();
$function$
;
CREATE OR REPLACE FUNCTION fixture.is_staff_business_session_current()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM auth.sessions AS s
    WHERE s.id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid
      AND s.user_id = auth.uid()
      AND s.created_at >= (
        (((now() AT TIME ZONE 'Asia/Tokyo') - INTERVAL '8 hours')::date
         + INTERVAL '8 hours')
        AT TIME ZONE 'Asia/Tokyo'
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION fixture.list_registered_cards_v2(p_query text, p_kind text, p_offset integer, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_store uuid := fixture.registered_card_store_scope();
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_number integer;
  v_result jsonb;
BEGIN
  IF char_length(v_query) > 80 OR p_kind IS NULL OR
     p_kind NOT IN ('all', 'reserved', 'general', 'legacy') OR
     p_status IS NULL OR p_status NOT IN ('active','revoked') OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION '検索条件を確認してください' USING ERRCODE = '22023';
  END IF;
  IF v_query ~ '^(no[.] ?)?[0-9]{1,6}$' THEN
    v_number := regexp_replace(v_query, '[^0-9]', '', 'g')::integer;
  END IF;
  WITH page AS (
    SELECT c.id, c.member_id, c.card_number, c.issued_at, c.issued_store_id, c.issued_by, c.revoked_at, m.display_name
    FROM fixture.member_card_credentials c
    JOIN fixture.members m ON m.id = c.member_id
    WHERE c.replaced_by IS NULL
      AND ((c.revoked_at IS NULL) = (p_status = 'active'))
      AND (v_store IS NULL OR c.issued_store_id = v_store)
      AND (p_kind = 'all'
        OR (p_kind = 'reserved' AND c.card_number BETWEEN 1 AND 100)
        OR (p_kind = 'general' AND c.card_number >= 101)
        OR (p_kind = 'legacy' AND c.card_number IS NULL))
      AND (v_query = '' OR c.card_number = v_number OR strpos(lower(m.display_name), v_query) > 0)
    ORDER BY c.card_number ASC NULLS LAST, c.id
    LIMIT 31 OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'scope_store_name', (SELECT name FROM fixture.stores WHERE id = v_store),
    'has_more', (SELECT count(*) > 30 FROM page),
    'cards', coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'card_number', lpad(c.card_number::text, 6, '0'),
      'display_name', c.display_name, 'issued_at', c.issued_at, 'revoked_at', c.revoked_at,
      'store_name', s.name, 'staff_name', sp.display_name,
      'customer_note', coalesce(note.note, ''),
      'balance', (SELECT coalesce(sum(t.delta), 0) FROM fixture.point_transactions t WHERE t.member_id = c.member_id)
    ) ORDER BY c.card_number ASC NULLS LAST, c.id), '[]'::jsonb))
  INTO v_result
  FROM (SELECT * FROM page ORDER BY card_number ASC NULLS LAST, id LIMIT 30) c
  LEFT JOIN fixture.stores s ON s.id = c.issued_store_id
  LEFT JOIN fixture.staff_profiles sp ON sp.id = c.issued_by
  LEFT JOIN fixture.member_customer_notes note ON note.member_id = c.member_id;
  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION fixture.manage_card_directory_points_v1(p_card_id uuid, p_action text, p_store_id uuid DEFAULT NULL::uuid, p_request_id uuid DEFAULT NULL::uuid, p_total_yen integer DEFAULT NULL::integer, p_redeem_points integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role text;
  v_scope_store uuid;
  v_card record;
BEGIN


  SELECT sp.role, sp.default_store_id INTO v_role, v_scope_store
  FROM fixture.staff_profiles sp
  WHERE sp.id = auth.uid() AND sp.active IS TRUE AND sp.retired_at IS NULL
  FOR SHARE OF sp;
  IF NOT FOUND OR fixture.is_shop_staff() IS DISTINCT FROM true THEN
    RAISE EXCEPTION '管理者として当営業日にログインしてください' USING ERRCODE = 'BC003';
  END IF;
  IF v_role = 'super_admin' THEN
    v_scope_store := NULL;
  ELSIF v_role = 'store_admin' THEN
    PERFORM 1
    FROM fixture.directory_point_grants g
    JOIN fixture.stores s ON s.id = g.store_id AND s.active IS TRUE
    WHERE g.staff_id = auth.uid() AND g.store_id = v_scope_store
    FOR SHARE OF g, s;
    IF NOT FOUND THEN
      RAISE EXCEPTION '一覧からのポイント操作は許可されていません' USING ERRCODE = 'BC003';
    END IF;
  ELSE
    RAISE EXCEPTION '一覧からのポイント操作は許可されていません' USING ERRCODE = 'BC003';
  END IF;

  IF p_action IS NULL OR p_action NOT IN ('select', 'visit', 'encounter', 'checkout') THEN
    RAISE EXCEPTION 'ポイント操作を確認してください' USING ERRCODE = '22023';
  END IF;
  IF p_action IN ('visit', 'checkout') AND v_scope_store IS NOT NULL
     AND p_store_id IS DISTINCT FROM v_scope_store THEN
    RAISE EXCEPTION '担当店舗のみポイント操作ができます' USING ERRCODE = 'BC003';
  END IF;

  SELECT c.member_id, c.card_number, c.issued_at, c.issued_store_id, c.issued_by, m.display_name
  INTO v_card
  FROM fixture.member_card_credentials c
  JOIN fixture.members m ON m.id = c.member_id
  WHERE c.id = p_card_id AND c.revoked_at IS NULL AND c.replaced_by IS NULL
    AND (v_scope_store IS NULL OR c.issued_store_id = v_scope_store);
  IF NOT FOUND THEN
    RAISE EXCEPTION '操作できる有効なカードが見つかりません。一覧を更新してください' USING ERRCODE = 'BC001';
  END IF;

  CASE p_action
    WHEN 'visit' THEN
      RETURN to_jsonb(fixture.award_visit_point_checked_v2(v_card.member_id, p_store_id, NULL, p_card_id));
    WHEN 'encounter' THEN
      RETURN to_jsonb(fixture.award_encounter_point_checked_v2(NULL, p_card_id));
    WHEN 'checkout' THEN
      RETURN fixture.process_checkout_once_checked_v2(
        p_request_id, v_card.member_id, p_store_id, p_total_yen, p_redeem_points, NULL, p_card_id);
    ELSE
      RETURN jsonb_build_object(
        'member_id', v_card.member_id, 'display_name', v_card.display_name,
        'balance', (SELECT coalesce(sum(t.delta), 0) FROM fixture.point_transactions t WHERE t.member_id = v_card.member_id),
        'card_number', lpad(v_card.card_number::text, 6, '0'), 'issued_at', v_card.issued_at,
        'issued_store_name', (SELECT s.name FROM fixture.stores s WHERE s.id = v_card.issued_store_id),
        'issued_staff_name', (SELECT sp.display_name FROM fixture.staff_profiles sp WHERE sp.id = v_card.issued_by),
        'operation_store_id', v_scope_store,
        'history', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'kind', h.kind, 'delta', h.delta, 'created_at', h.created_at,
            'store', s.name, 'encounter_staff_name', h.encounter_staff_name
          ) ORDER BY h.created_at DESC, h.id DESC), '[]'::jsonb)
          FROM (
            SELECT t.id, t.kind, t.delta, t.created_at, t.store_id, t.encounter_staff_name
            FROM fixture.point_transactions t
            WHERE t.member_id = v_card.member_id AND (v_scope_store IS NULL OR t.store_id = v_scope_store
              OR (t.kind = 'encounter' AND t.staff_id = auth.uid()))
            ORDER BY t.created_at DESC, t.id DESC LIMIT 20
          ) h LEFT JOIN fixture.stores s ON s.id = h.store_id
        )
      );
  END CASE;
END;
$function$
;
CREATE OR REPLACE FUNCTION fixture.process_checkout_once_checked_v2(p_request_id uuid, p_member_id uuid, p_store_id uuid, p_total_yen integer, p_redeem_points integer, p_card_token text, p_directory_card_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_staff_id uuid := auth.uid();
  v_old fixture.checkout_requests%ROWTYPE;
  v_balance bigint;
  v_paid bigint;
  v_earned integer;
BEGIN
  IF v_staff_id IS NULL
     OR NOT fixture.is_shop_staff() THEN
    RAISE EXCEPTION 'スタッフ権限がありません';
  END IF;

  IF NOT fixture.is_staff_business_session_current() THEN
    RAISE EXCEPTION '営業日が切り替わったため再ログインしてください';
  END IF;

  IF p_request_id IS NULL
     OR p_member_id IS NULL
     OR p_store_id IS NULL
     OR p_total_yen IS NULL
     OR p_redeem_points IS NULL
     OR p_total_yen < 0
     OR p_redeem_points < 0
     OR p_redeem_points > p_total_yen
     OR p_redeem_points % 10 <> 0 THEN
    RAISE EXCEPTION '会計データが不正です';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_request_id::text, 0
    )
  );

  PERFORM 1
  FROM fixture.members
  WHERE id = p_member_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '会員が見つかりません' USING ERRCODE = 'BC002';
  END IF;

  SELECT *
  INTO v_old
  FROM fixture.checkout_requests
  WHERE request_id = p_request_id;

  IF FOUND THEN
    IF v_old.member_id IS DISTINCT FROM p_member_id
       OR v_old.store_id IS DISTINCT FROM p_store_id
       OR v_old.staff_id IS DISTINCT FROM v_staff_id
       OR v_old.total_yen IS DISTINCT FROM p_total_yen
       OR v_old.redeemed_points IS DISTINCT FROM p_redeem_points THEN
      RAISE EXCEPTION '受付IDが別の会計で使用されています';
    END IF;

    RETURN jsonb_build_object(
      'replayed', true,
      'paid_yen',
        v_old.total_yen - v_old.redeemed_points,
      'redeemed_points', v_old.redeemed_points,
      'earned_points', v_old.earned_points,
      'balance_after', v_old.balance_after
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM fixture.stores
    WHERE id = p_store_id
      AND active = true
  ) THEN
    RAISE EXCEPTION '有効な店舗ではありません';
  END IF;

  IF p_directory_card_id IS NULL THEN
    PERFORM fixture.require_current_point_card(p_member_id, p_card_token);
  ELSE
    PERFORM fixture.require_directory_point_card(p_directory_card_id, p_member_id);
  END IF;

  SELECT COALESCE(SUM(delta), 0)
  INTO v_balance
  FROM fixture.point_transactions
  WHERE member_id = p_member_id;

  IF p_redeem_points > v_balance THEN
    RAISE EXCEPTION 'ポイント残高が不足しています';
  END IF;

  v_paid := p_total_yen::bigint - p_redeem_points;
  v_earned := ((v_paid / 100) * 5)::integer;

  IF p_redeem_points > 0 THEN
    INSERT INTO fixture.point_transactions (
      member_id, store_id, staff_id,
      kind, delta
    )
    VALUES (
      p_member_id, p_store_id, v_staff_id,
      'redeem', -p_redeem_points
    );
  END IF;

  IF v_earned > 0 THEN
    INSERT INTO fixture.point_transactions (
      member_id, store_id, staff_id,
      kind, delta
    )
    VALUES (
      p_member_id, p_store_id, v_staff_id,
      'earn', v_earned
    );
  END IF;

  INSERT INTO fixture.checkout_requests (
    request_id, member_id, store_id,
    staff_id, total_yen,
    redeemed_points, earned_points,
    balance_after
  )
  VALUES (
    p_request_id, p_member_id, p_store_id,
    v_staff_id, p_total_yen,
    p_redeem_points, v_earned,
    v_balance - p_redeem_points + v_earned
  );

  RETURN jsonb_build_object(
    'replayed', false,
    'paid_yen', v_paid,
    'redeemed_points', p_redeem_points,
    'earned_points', v_earned,
    'balance_after',
      v_balance - p_redeem_points + v_earned
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION fixture.registered_card_activity_v2(p_card_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_store uuid := fixture.registered_card_store_scope();
  v_member uuid;
BEGIN
  SELECT c.member_id INTO v_member
  FROM fixture.member_card_credentials c
  WHERE c.id = p_card_id AND c.member_id IS NOT NULL AND c.replaced_by IS NULL
    AND (v_store IS NULL OR c.issued_store_id = v_store);
  IF NOT FOUND THEN
    RAISE EXCEPTION '表示できる登録済みカードが見つかりません' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'visits', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'store_name', visit.store_name, 'count', visit.total, 'last_at', visit.last_at
      ) ORDER BY visit.store_name, visit.store_id), '[]'::jsonb)
      FROM (
        SELECT t.store_id, s.name as store_name, count(*) AS total, max(t.created_at) AS last_at
        FROM fixture.point_transactions t LEFT JOIN fixture.stores s ON s.id = t.store_id
        WHERE t.member_id = v_member AND t.kind = 'visit' AND (v_store IS NULL OR t.store_id = v_store)
        GROUP BY t.store_id, s.name
      ) visit
    ),
    'encounter_count', CASE WHEN v_store IS NULL THEN (
      SELECT count(*) FROM fixture.point_transactions t WHERE t.member_id = v_member AND t.kind = 'encounter'
    ) END,
    'history', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'kind', h.kind, 'delta', h.delta, 'created_at', h.created_at,
        'store_name', s.name, 'encounter_staff_name', h.encounter_staff_name
      ) ORDER BY h.created_at DESC, h.id DESC), '[]'::jsonb)
      FROM (
        SELECT t.id, t.kind, t.delta, t.created_at, t.store_id, t.encounter_staff_name
        FROM fixture.point_transactions t
        WHERE t.member_id = v_member AND (v_store IS NULL OR (t.store_id = v_store AND t.kind <> 'encounter'))
        ORDER BY t.created_at DESC, t.id DESC LIMIT 20
      ) h LEFT JOIN fixture.stores s ON s.id = h.store_id
    )
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION fixture.registered_card_store_scope()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role text;
  v_store uuid;
BEGIN
  IF fixture.is_shop_staff() IS DISTINCT FROM true THEN
    RAISE EXCEPTION '管理者として当営業日にログインしてください' USING ERRCODE = '42501';
  END IF;
  SELECT sp.role, sp.default_store_id INTO v_role, v_store
  FROM fixture.staff_profiles sp WHERE sp.id = auth.uid() AND sp.active IS TRUE;
  IF v_role = 'super_admin' THEN RETURN NULL; END IF;
  IF v_role = 'store_admin' AND EXISTS (
    SELECT 1 FROM fixture.stores s WHERE s.id = v_store AND s.active IS TRUE
  ) THEN RETURN v_store; END IF;
  RAISE EXCEPTION '登録済みカード一覧を閲覧する権限がありません' USING ERRCODE = '42501';
END;
$function$
;
CREATE OR REPLACE FUNCTION fixture.require_current_point_card(p_member_id uuid, p_card_token text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF p_card_token IS NULL THEN
    PERFORM 1 FROM fixture.member_card_credentials c
    WHERE c.member_id = p_member_id AND c.revoked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM fixture.member_card_credentials previous WHERE previous.replaced_by = c.id)
    FOR SHARE OF c;
  ELSE
    PERFORM 1 FROM fixture.member_card_credentials c
    WHERE c.member_id = p_member_id AND c.revoked_at IS NULL
      AND p_card_token ~ '^[A-Za-z0-9_-]{43}$'
      AND c.token_hash = extensions.digest(p_card_token, 'sha256')
    FOR SHARE OF c;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION '失効したカード、または再照会が必要なカードです。有効なカードを読み取ってください'
      USING ERRCODE = 'BC001';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION fixture.require_directory_point_card(p_card_id uuid, p_member_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM 1 FROM fixture.member_card_credentials c
  WHERE c.id = p_card_id AND c.member_id = p_member_id
    AND c.revoked_at IS NULL AND c.replaced_by IS NULL
  FOR SHARE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'カードが無効になりました。一覧を更新してください' USING ERRCODE = 'BC001';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION fixture.staff_directory_points_access_v1()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT fixture.is_shop_staff() IS TRUE AND EXISTS (
    SELECT 1
    FROM fixture.staff_profiles sp
    LEFT JOIN fixture.directory_point_grants g ON g.staff_id = sp.id AND g.store_id = sp.default_store_id
    LEFT JOIN fixture.stores s ON s.id = g.store_id AND s.active IS TRUE
    WHERE sp.id = auth.uid() AND sp.active IS TRUE AND sp.retired_at IS NULL
      AND (sp.role = 'super_admin' OR (sp.role = 'store_admin' AND s.id IS NOT NULL))
  );
$function$
;
SET check_function_bodies=on;
-- Only checkout/visit test fixture privileges, no direct client table access.
REVOKE ALL ON SCHEMA fixture,private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fixture FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE fixture.scope_grants(staff_id uuid,store_id uuid,permission_key text,active boolean NOT NULL,PRIMARY KEY(staff_id,store_id,permission_key));
ALTER TABLE fixture.scope_grants ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION private.require_staff_point_store_v1(p_store_id uuid,p_permission text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p fixture.staff_profiles%ROWTYPE;
BEGIN
 SELECT * INTO p FROM fixture.staff_profiles WHERE id=auth.uid() AND active AND retired_at IS NULL FOR SHARE;
 IF NOT FOUND OR fixture.is_shop_staff() IS DISTINCT FROM true THEN RAISE EXCEPTION 'scope denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM fixture.stores WHERE id=p_store_id AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'scope denied' USING ERRCODE='42501'; END IF;
 IF p.role='super_admin' THEN RETURN; END IF;
 PERFORM 1 FROM fixture.scope_grants WHERE staff_id=p.id AND store_id=p_store_id AND permission_key=p_permission AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'scope denied' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.require_staff_point_store_v1(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE private.staff_point_store_grants_v1(dummy boolean);
ALTER TABLE private.staff_point_store_grants_v1 ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.staff_scoped_point_operation_v1(text,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION public.staff_point_operation_stores_v1() RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
REVOKE ALL ON FUNCTION public.staff_scoped_point_operation_v1(text,jsonb),public.staff_point_operation_stores_v1() FROM PUBLIC,anon,authenticated,service_role;
