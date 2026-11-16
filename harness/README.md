# Harness: Wiki categories

カテゴリ一覧はハーネスが管理する。

- **正本（運用）**: `{VAULT_PATH}/_schema/wiki-categories.json`
- **リポジトリ内の説明・スキーマ**: このフォルダ
- AIは一覧を読んで既存カテゴリを優先する。当てはまらなければ新規カテゴリ名で `draft/Wiki/<New>/` に書いてよい。
- **一覧の更新はプログラムのみ**（`applyDraft` 時）。AIが `_schema/wiki-categories.json` を直接編集しない。
