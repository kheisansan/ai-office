# ADR 0004: LLM Wiki Vault は設定で指定する

- Status: Accepted
- Date: 2026-11-16

## Context

実保管庫は iCloud 上の Obsidian（個人データ）。リポジトリにパスをハードコードすると移植性が落ち、公開時のリスクも増える。

## Decision

- `VAULT_PATH`（`.env`）または `config/settings.json` の `vaultPath` で指定する。
- 優先順位: 環境変数 > settings.json > `fixtures/sample-vault`。
- `config/settings.json` は gitignore。`settings.example.json` だけコミット。
- `office config` で解決結果を表示する。
- フェーズ4のダッシュボード設定画面も同じキーを読む。

## Consequences

実 Vault を差し替え可能。デモは fixtures、本番運用は settings で your personal vault 等を指す。
