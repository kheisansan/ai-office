# 下書き検証（プログラムが実装、AIは自己点検にも使う）

合格条件:
1. frontmatter が YAML としてパースできる
2. 必須キー（tags, status, created, updated）がある
3. `[[wikilink]]` が候補／既存ページに存在する（リンク切れ0）
4. 書き込み先がジョブの `draft/` 配下のみ
5. パスに `OpenClaw` を含まない
6. index.patch / log.patch が空でない（統合時）
