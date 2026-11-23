# Cloudflare 本番用 読取専用ページ差分（実行前レビュー用）

## 現行本番の実物確認
- 本番URL: https://shop-point-nfc-customer-test-1107.pages.dev/staff-card-reader.html
- 固有デプロイURL: https://840b4dfc.shop-point-nfc-customer-test-1107.pages.dev/staff-card-reader.html
- 両URLで「既存のNFCカードを読み取って、カードURLを確認します。ポイント操作や会員情報の変更は行いません。」を確認
- Cloudflare管理画面の現行Production Deployment ID: `840b4dfc-5ce0-4d0e-89eb-7298df9534ae`（ユーザーのスクリーンショット）
- 本番アップロードは24ファイルで、`staff.html`, `staff-card-reader.html`, `common/bees_nfc_reader.js` を含む

## ソース差分
| 項目 | 旧読取ページ | 実機合格済みの隔離版 |
|---|---|---|
| ファイル | `v8-offline-staging/staff-card-reader.html` | `v8-offline-staging/staff-card-reader-dedicated-isolated.html` |
| NFC共通JS | `common/bees_nfc_reader.js` | 同じ共有モジュール |
| CSP connect-src | `'none'` | Supabaseの指定ホスト |
| 会員照会 | なし | `staff_prepared_card_status`, `staff_card_details_v3` |
| スタッフ認証 | なし | 独立ログイン |
| 更新・会計 | なし | なし |

## 推奨変更範囲（まだ本番適用しない）
1. **本番の既存24ファイル一式を保持**。アップロード方式では差分だけをアップロードして既存ファイルを消さないこと。
2. 既存の `staff-card-reader.html` を無審査で上書きしない。まず別名の新規読取専用HTMLを候補にする。
3. 既存 `staff.html` の導線変更は、リンク先の新規ページが本番で利用可能と確認できた後、独立した変更として扱う。
4. `common/bees_nfc_reader.js` は既存と差分比較し、不要なら変更しない。
5. デプロイ前に現行24ファイルの完全な復旧用コピーと、Cloudflare管理画面からロールバック可能な候補を確認する。
6. 本番公開は別途ユーザーの明示承認後のみ。

## 未完了ゲート
- 本番24ファイルの完全なコピー/復旧可能性
- 現行本番 `common/bees_nfc_reader.js` と隔離版の内容一致検証
- 既存本番スタッフ画面のリンク実体と認証導線の確認
- ログイン失効・セキュリティレビュー
- 本番公開の明示承認

## 完了済みの実機確認（繰り返さない）
隔離版でNFC読取、スタッフ認証、会員名・5pt残高表示、読取中止。

**本書はリリース差分の計画であり、Cloudflareへのデプロイは実行していない。**
