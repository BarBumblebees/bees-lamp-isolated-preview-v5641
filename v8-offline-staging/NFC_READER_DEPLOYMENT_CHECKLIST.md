# カード読取専用ページ：公開前チェック（2026-11-22 更新）

## 実装済み（mainブランチの未公開候補）
- NFC共通読取モジュールの再利用とカードURL形式チェック。
- 既存スタッフセッションの参照、営業日・トークン期限・セッション変更の検査。リフレッシュトークンは使用・更新しない。
- 会員照会、カードディレクトリとの会員ID突合、登録名・既存メモの編集、詳細履歴表示。
- 権限照合後の来店ポイント・会計ポイント処理、店舗選択の検証。
- 会計受付IDの端末保存、未確定会計の再照会、異常データ・二重操作の停止。
- カード停止、新カードURL準備、書込確認後の再発行処理。
- Node静的回帰テストをGitHub Actionsで実行。最新の成功コミット：675249fc。
- 本番DB・既存公開画面・隔離公開ブランチは変更していない。

## 未確認（完了と扱わない）
- Android Chrome実機のNFC読み取り、ログイン・会員照会・各操作のE2E動作。
- DBの実RPC権限と戻り値（テストカードで未検証）。
- カード停止後にページを再読込した場合の再発行導線。現状は active カード検索を使い、停止済みカードの再取得は保証できない。
- 未確定会計の復旧動線と、実端末のlocalStorage保持。
- スタッフ画面の運用先は過去の引き継ぎ資料で `https://shop-point-nfc-customer-test-1107.pages.dev`（`/staff` および `/staff.html`）と記録されている。ただし現在の稼働版・配信内容・GitHubソースとの一致は未確認。同一オリジンへの専用ページ配置も未実施。GitHub Pages隔離スタッフ画面は CSP connect-src 'none' でDB通信できない。

## 公開判断の前提
1. 過去資料に記録された Cloudflare Pages 配信元 `https://shop-point-nfc-customer-test-1107.pages.dev` の現行スタッフ画面と、GitHub候補ソースとの差分を監査する。既存配信物を上書きせず、専用ページ・共通JSの追加方法を確定する。
2. 公開前の隔離テスト環境で同一オリジン認証・CSP・NFC読み取り・照会を検証し、その後、テストスタッフ・テストカードで編集、履歴、来店ポイント、会計再確認、停止・再発行を検証する。
3. 停止済みカードを再読み込み後に安全に選択できる手段を確定する（本番DBの仕様変更は別途承認）。
4. 検証後、公開反映の個別承認を得る。

候補HTML: v8-offline-staging/staff-card-reader-live-candidate.html（mainのみ）
候補JS: v8-offline-staging/common/staff_card_reader.js（mainのみ）
公開隔離プレビュー: nfc-dedicated-v5-isolated-preview ブランチ（未変更）

## 重複防止・注意
- 完了した静的テストや保存作業を再依頼しない。静的テスト成功と実機動作確認は別物。
- 会計の保存データ照合に関する実装と回帰テストは完了。追加の細分化よりE2Eと配信経路確認を優先。
- 停止済みカードの再発行問題は未解決。安全なAPI仕様確認なしに推測で修正しない。

## 配信経路の確認事項（2026-11-22追記）
- 過去資料の確認済み運用オリジン：`https://shop-point-nfc-customer-test-1107.pages.dev`。スタッフ画面は `/staff` または `/staff.html` と記録されているが、現時点の実URLは再検証が必要。
- 候補ファイル：`staff-card-reader-live-candidate.html`、`common/staff_card_reader.js`、`common/bees_nfc_reader.js`。相対パスを維持する。
- 既存スタッフ画面の `localStorage` セッションを使うため、Cloudflare PagesとGitHub Pagesの異なるオリジン間では認証を共有できない。
- `main/v8-offline-staging/staff.html` は `connect-src 'none'` の隔離版。これをそのまま運用環境へ上書きしない。
- **未承認の公開操作は実施しない**。公開用のビルド経路、配信先の現行ファイル、ロールバック手段を確認してから、必要な変更範囲の承認を得る。
