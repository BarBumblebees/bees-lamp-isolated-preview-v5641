# BEES POINT NFC v8 — isolated offline preview deployment

Status: **NOT DEPLOYED**. This branch contains navigation test harnesses only. The actual v8 offline ZIP has not been uploaded.

## Deployment safety requirements

1. Keep all changes on `nfc-dedicated-v5-isolated-preview`. Do not merge to `main` or publish as the production app.
2. Source artifact: `BEES_POINT_NFC_v8_隔離オフライン検証_未公開.zip` (24 files; local artifact, not committed here).
3. Preserve the relative paths of `staff.html`, `index.html`, `common/`, `icons/`, `images/`, and `_headers`.
4. Verify against `BEES_NFC_v8_隔離配置マニフェスト.json` before/after upload. Do not upload credentials or real Supabase endpoints.
5. This is an **offline UI-only** build: no real login, NFC, database reads/writes, or points transactions should be attempted.
6. Only claim deployment after checking GitHub files and the actual preview URL; only claim functional validation after running browser tests.

## Existing test pages

- `nfc-ui-isolated-smoke.html` — navigation-only mock.
- `nfc-navigation-regression-v5.html` — separate regression harness with dummy customers.

## Blocker

The connected GitHub interface can create UTF-8 text files, but cannot directly import a local ZIP. The local shell cannot reach github.com. Uploading the real 24-file build remains outstanding. No production database or production deployment has been changed by this documentation commit.
