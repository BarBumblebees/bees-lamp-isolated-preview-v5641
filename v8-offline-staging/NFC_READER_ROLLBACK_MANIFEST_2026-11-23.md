# BEES POINT NFC — 読取専用ページ復旧・差分管理台帳

更新: 2026-11-23

## 適用範囲
GitHub Pages 隔離プレビュー `BarBumblebees/bees-lamp-isolated-preview-v5641` の `nfc-dedicated-v5-isolated-preview` ブランチ。**Cloudflare Pages本番には適用していない**。

## 現在の復旧対象（GitHub blob SHAで特定）
| ファイル | Git blob SHA | 用途 |
|---|---|---|
| `v8-offline-staging/staff.html` | `f78ee037b31989dce5eff14297d168b9737f513f` | 隔離スタッフ画面。読取専用ページへのリンク変更済 |
| `v8-offline-staging/staff-card-reader-dedicated-isolated.html` | `8ec94eb41c9be30a1886077be8d8b6e4894af4c4` | 実機合格済の独立読取専用画面 |
| `v8-offline-staging/nfc-staff-readonly-entry.html` | `cb1112d114be456171b4f62573e438791a1adeff` | 独立入口 |
| `v8-offline-staging/common/bees_nfc_reader.js` | `75d9da82dd140991543fde888fcd449deed39c8b` | NFC共通処理 |

## 変更履歴の起点
- `4b1d4094725d7bc774e9a4ac1c0c7c67defff0e0` : 実機合格済の専用ページ
- `a023147775d5acafd9852781dd538281e1b568d9` : 隔離入口
- `f6663eb7dda1ee17c39905a96f7fbf75a782c179` : 隔離スタッフ画面の読取専用リンク修正

## 隔離版ロールバック手順（本番では実行しない）
1. 復旧対象のページと上表の blob SHA を照合し、差分と変更履歴を記録する。
2. 変更したファイルのみを、承認された既知の正常なコミット内容に戻す。既存の読取専用ページや共通NFC処理は不用意に巻き戻さない。
3. GitHub Pagesの反映を待ち、入口・スタッフ画面からのリンク先が存在することだけ確認する。
4. ポイント付与・会計・DB更新操作は一切行わない。

## Cloudflare本番のリリース・復旧ゲート
- 現在観測された公開URL: `https://shop-point-nfc-customer-test-1107.pages.dev/staff`
- 公開画面で観測した表示: `v5.6.41`。**表示バージョンはデプロイIDを証明しない**。
- 過去の復旧基準として記録されたデプロイID: `f41e877c-9c7f-49a4-abf0-196dbc21adb1`。現時点で実在・現行・復旧可能か未確認。
- Cloudflare Pagesプロジェクトの管理権限、現行デプロイID、ビルド/配信経路、復旧候補の実在、ロールバック操作を**Cloudflare側で確認するまでは、本番リリース不可**。
- 本番スタッフ画面の既存「カード読取専用ページを開く」の実際のリンク先は未検証。
- 本番への書込、ポイント更新、会計、デプロイ、ロールバックはユーザーの別途明示承認まで禁止。

## 重複作業の禁止
実機合格済み: NFCカード読取、カードURL形式、スタッフ認証、会員名・5pt残高表示、読取中止。再試験は新規変更点に限る。

## 誤認防止
この文書は隔離環境の復旧対象を固定するものであり、Cloudflare本番の復旧保証や本番配信可能の判定ではない。
