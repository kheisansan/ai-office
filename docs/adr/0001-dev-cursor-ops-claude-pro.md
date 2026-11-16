# ADR 0001: 開発は Cursor Auto、運用 AI は Claude Pro

- Status: Accepted
- Date: 2026-11-16

## Context

企画書は「構築も運用も Claude Pro」として、API キー無し・同じ使用量枠を分け合う前提だった。
一方、構築期間は開発セッションが枠の大半を食いやすい。

## Decision

- **開発**: Cursor のモデル指定 **Auto** を基本にする（コード・テスト・リファクタ・ドキュメント）。
- **運用（AI社員の要約・統合・回答）**: Claude Code の `claude -p` を **Pro ログイン**のまま使う（API キー無し）。
- ECC は全部入りインストールせず、`vendor/ecc` に common / typescript rules と開発用スキルだけを置く。

## Consequences

- Pro の枠は主に運用と、必要なときだけの Claude Code レビューに使える。
- ランナーは将来 `claude -p` を呼ぶが、フェーズ0の dry-run はスタブ AI でトークン0。
- 企画書の「課金」行は「運用は Pro / 開発は Cursor Auto」に読み替える（本 ADR が正）。
