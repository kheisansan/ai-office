# Wiki ページ書式

## 置き場所（ハーネス）
- 正: `draft/Wiki/<Category>/<page>.md`
- 誤: `draft/Wiki/<page>.md`
- カテゴリ一覧の正本: 保管庫 `_schema/wiki-categories.json`（AIは編集しない）
- 既存カテゴリ優先。なければ新規 Category フォルダを作ってよい（一覧登録は approve 時のプログラム）

```yaml
---
tags: []
related: ["[[関連ページ]]"]
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

必須:
- 1テーマ1ページ
- カテゴリフォルダ配下
- `related` と `## Sources`
