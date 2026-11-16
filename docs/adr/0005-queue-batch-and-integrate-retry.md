# ADR 0005: キュー一括処理と統合リトライ

- Status: Accepted
- Date: 2026-11-16

## Decision

- `office enqueue <URL>` で `stage=queued` のジョブだけ作る。
- `office ingest`（URLなし）で古い順に最大 `INGEST_BATCH_LIMIT` 本処理する。
- 統合後の検証が不合格なら、フィードバック付きで統合をやり直す（最大2回＝合計3試行）。それでもダメなら `needs_human`。
- 処理終了・承認待ちは macOS 通知（`AI_OFFICE_NOTIFY=0` で無効化）。
- launchd は用意のみで読み込まない。
