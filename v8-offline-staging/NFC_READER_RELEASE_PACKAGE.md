# BEES POINT NFC — カード読取専用ページの追加配信パッケージ（未公開）

更新: 2026-11-23。**本書は配信準備用。公開操作の承認ではありません。**

## 既に確認したこと
- Cloudflare Pages project: `shop-point-nfc-customer-test-1107`。Production は `main`。
- 2026-11-22 の Preview deployment `3ac04c60-7e21-4746-b984-7b3fbdf89522`（branch alias `bees-nfc-reader-test`）は success、24ファイルをアップロード。配信ルートに `v8-offline-staging/` が含まれる。
- 同プレビューの `/v8-offline-staging/staff-card-reader.html` は従来のカードURL読取画面で表示確認済み。
- Production `/staff` は v5.6.41。Production `/staff-card-reader` は既存のURL読取専用画面。**この2ファイルを上書きしない。**
- GitHub `main` の新候補はまだCloudflare上で稼働確認していない。

## 新候補の3ファイル（同一階層を維持）
- `v8-offline-staging/staff-card-reader-live-candidate.html`
- `v8-offline-staging/common/staff_card_reader.js`
- `v8-offline-staging/common/bees_nfc_reader.js`

ページは `./common/...` の相対パスを使用。フォルダ階層を崩すと読み込めない。

## デプロイ前に必要なこと
1. Cloudflareの現行Production成果物を完全に保全し、ロールバック可能なデプロイIDを控える。
2. Cloudflareのアップロードは「差分追加」ではなくサイト全体の置換になる可能性がある。**3ファイルだけをProductionへアップロードしない。**
3. Preview用に現行サイトの全ファイルと新候補3ファイルを統合した完全な配信フォルダを構成する。現行Productionの `staff.html`、顧客画面、リダイレクト、Functionsを欠落させない。
4. PreviewはProductionとオリジンが異なるため、Production `localStorage` のスタッフセッションを共有しない。Preview上の認証失敗は仕様上あり得る。実会員操作で回避しない。
5. 新候補はDB接続可能なCSPで、権限があれば実ポイントを変更する。Previewであっても本番DBへ接続し得るため、テスト専用カードと許可された隔離DBでのみ検証する。
6. 安全な統合配信と隔離DBの確認が完了するまで、Production導線 `/staff-card-reader` を切り替えない。

## 現時点の判断
- **完了**：既存プレビューの表示、公開/未公開の区別、候補の3ファイル特定、GitHub静的CI。
- **未完了**：現行Production全成果物のバックアップ、統合ビルド、隔離DBでの動的テスト、実機NFC検証、ロールバック実証。
- **禁止**：Productionへの直接アップロード、既存staff.htmlの上書き、未承認の本番DB更新。

参照：`NFC_READER_DEPLOYMENT_CHECKLIST.md`。
