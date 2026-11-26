-- R31 production preflight (read only). No function calls against member data.
BEGIN READ ONLY;
SELECT n.nspname AS schema,p.proname,pg_get_function_identity_arguments(p.oid) AS args,md5(pg_get_functiondef(p.oid)) AS fingerprint,has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,has_function_privilege('anon',p.oid,'EXECUTE') AS anon
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('private','public') AND (p.proname LIKE 'ml40_%' OR p.proname IN ('is_shop_staff','is_staff_business_session_current','registered_card_store_scope','staff_directory_points_access_v1','staff_card_details_v3','staff_prepared_card_status','list_registered_cards_v2','registered_card_activity_v2','manage_card_directory_points_v1','process_checkout_once_checked_v2','award_visit_point_checked_v2','award_encounter_point_checked_v2','save_registered_card_note_v1','require_directory_point_card','require_current_point_card')) ORDER BY schema,proname,args;
SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema IN ('public','private') AND (table_name LIKE 'ml40_%' OR table_name IN ('members','staff_profiles','stores','point_transactions','member_card_credentials','member_customer_notes','directory_point_grants','checkout_requests')) ORDER BY table_schema,table_name;
ROLLBACK;
