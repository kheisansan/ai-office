# ADR 0008: ダッシュボードは Express + 静的 UI

- Status: Accepted
- Date: 2026-11-16

## Decision

- `office serve` で localhost に Express を立て、`dashboard/public` を配信する。
- React / バンドラは使わない（フェーズ4 MVP）。
- API は既存の `runner/ingest`・`runner/ask`・集計モジュールを薄く包む。
- 設定パスの Web からの書き換えはしない（表示のみ）。

## Why

完了条件は「画面から承認」「使用量が見える」。ビルドなしで既存ランナーに接続するのが最短。ポートフォリオ用の見た目は静的 CSS で足りる。
