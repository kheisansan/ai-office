# ADR 0007: 根拠限定の回答（office ask）

- Status: Accepted
- Date: 2026-11-16

## Decision

- `office ask "<question>"` が `DATA_DIR/answers/<id>/` に質問ジョブを作る。
- プログラムが index / aliases / tags / 全文で候補を絞り `candidates.json` を書く。
- 回答担当（`claude -p` または stub）が `answer.md` を書く。主張には候補内の `[[ページ]]` のみ。
- プログラムが出典検証。不合格ならフィードバック付きで **最大1回** やり直し（合計2試行）。だめなら `needs_human`。
- 合格時、プログラムが vault `log.md` に `[QUERY]` を追記する。
- 不足情報は `draft/ingest-suggestions.md`、Wiki 追記案は `draft/append-proposal.md`（未承認・未反映）。

## Why

回答をモデルの一般知識に委ねると Wiki が腐る。候補絞りと出典検証をハーネス側に置き、AI は候補本文だけを読む。
