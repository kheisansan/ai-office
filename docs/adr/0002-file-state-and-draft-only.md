# ADR 0002: 状態はファイル、AI は draft のみ

- Status: Accepted
- Date: 2026-11-16

## Decision

- ジョブ状態は `DATA_DIR/queue/<id>/` のファイルで持つ。
- AI は `draft/` にだけ書き、保管庫への反映はプログラム + 人の承認。

## Why

権限で「書けない」ことが最強のハーネス。どこで止まっても再開できる。
