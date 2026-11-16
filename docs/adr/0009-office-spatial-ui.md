# ADR 0009: オフィス空間 UI（社員クリック操作）

- Status: Accepted
- Date: 2026-11-16

## Decision

- ダッシュボードの入口はタブ一覧ではなく、CSS/SVG の俯瞰オフィス空間にする。
- 操作はホットスポット（取り込み社員 / 回答社員 / 掲示板 / モニター）→ スライドインパネル。
- 素材はリポジトリ内のオリジナル SVG（`dashboard/public/assets/`）。外部動画・ゲームエンジンは使わない。
- API は ADR 0008 の Express ルートをそのまま使う。バックエンド変更は原則なし。
- busy / idle / needs_you は `/api/office` の集計と実行中フラグから CSS で表示する。

## Why

「AI 社員がいるオフィス」という体験を、ビルドなし・静的 UI のまま表現するため。情報設計（ingest / ask / review / queue+usage）は維持し、配置だけ空間に移す。

## Consequences

- `dashboard/public/{index.html,styles.css,app.js}` が空間 UI 前提になる。
- デモ手順はクリック操作ベース（`docs/DEMO.md`）。
- React 移行や Pixi 等は将来フェーズで再検討。
