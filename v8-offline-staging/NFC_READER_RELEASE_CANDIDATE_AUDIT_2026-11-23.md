# NFCカード読取専用 — 既存候補監査（2026-11-23）

## 監査した実物
- GitHub `main:v8-offline-staging/staff-card-reader-live-candidate.html`（未公開候補）
- GitHub `nfc-dedicated-v5-isolated-preview:v8-offline-staging/staff-card-reader-dedicated-isolated.html`（隔離版）
- GitHub `nfc-dedicated-v5-isolated-preview:v8-offline-staging/nfc-staff-readonly-entry.html`（隔離入口）

## 重要な発見
`main` の既存「未公開候補」には**カード再発行操作**のUIが含まれる（「旧カードを一時停止」「新カードURLを準備」「再発行を確定」）。HTMLに更新系API呼び出しが直接なくても、参照JSの動作次第で更新が発生する可能性がある。**読取専用の正式導入候補として無審査で採用してはいけない。**

隔離版の専用ページは、NFC読取、正規スタッフ認証、`staff_card_stock_stores`、`staff_prepared_card_status`、`staff_card_details_v3` を使用。会員・ポイント更新の操作UIはない。ユーザーの実機確認では会員照会と読取中止が成功した。

## 安全な導入方針
- 既存の未公開候補は**保管したまま変更しない**。
- 読取専用の隔離版を基礎として、別ファイルのリリース候補を作成する。
- 既存スタッフ画面や本番DBの変更は禁止のまま維持する。
- 本番配信先、配信権限、ロールバック方式が確認され、ユーザーが別途明示承認するまで公開しない。

## 未確認
- 本番ホスティングの具体的なリポジトリ・デプロイ経路
- 本番配信のバックアップ/復旧手順
- 本番環境でのログイン・失効・CSPの適合性
- 旧未公開候補のJSに含まれる更新処理の詳細（この監査では未実施）

## 完了済みの実機試験（繰り返さない）
NFC読取、カード形式判定、スタッフログイン、会員情報・5pt残高表示、読み取り中止。

**この監査で本番サイト・DB・会員・ポイントデータは変更していない。**
