# AI Office

個人事業の **LLM Wiki（Obsidian）** を、AI社員と普通のプログラムの組み合わせで回す知識管理システム。ポートフォリオ公開用。

## 何を見せるか

1. **グラフ設計** — AI / プログラム / 人の承認をノードでつなぐ業務フロー
2. **ハーネス** — 保管庫直書き禁止・`OpenClaw/` 禁止・削除禁止を hook と権限で強制
3. **ループ** — 成功基準・検証者・止める条件
4. **根拠限定の回答** — Wiki だけを根拠にし、出典を機械検証
5. **予算内運用** — Claude Pro の枠で運用し、トークンを計測
6. **見える化** — AIオフィス風ダッシュボード（フェーズ4）


## 構成（ざっくり）

```
人 → office CLI / dashboard
       ├─ ingest: fetch → prepare → summarize → integrate → verify → approve → apply
       └─ ask:    candidates → answer → citation verify → QUERY log
プログラムが取得・検証・反映。AI（claude -p）は要約・統合・回答のみ。draft/ 以外には書かない。
```

## 開発と運用の分担

| 用途 | ツール | 備考 |
|---|---|---|
| **開発** | **Cursor（モデル指定 Auto）** | コード・テスト・設計。Claude Pro の枠を開発で圧迫しない |
| **運用（AI社員）** | Claude Code `claude -p`（Pro ログイン） | 要約・統合・回答。API キーは使わない |

詳細は [docs/adr/0001-dev-cursor-ops-claude-pro.md](docs/adr/0001-dev-cursor-ops-claude-pro.md)。

## 現状（フェーズ5 / MVP）

取り込み・回答・ダッシュボードまで一通り動く。公開用に MIT、秘密情報スキャン、デモスクリプト付き。




```bash
npm install
cp config/settings.example.json config/settings.json  # vaultPath を LLM Wiki に変更

npm test
npm run office -- config

# キューに積む（まだ AI は動かない）
npm run office -- enqueue "https://youtu.be/AAAA"
npm run office -- enqueue "https://youtu.be/BBBB"

# まとめて処理（既定は ingestBatchLimit 本。Claude Pro 枠を使う）
npm run office -- ingest
npm run office -- ingest --limit 2

# 1本だけ即時
npm run office -- ingest "https://youtu.be/CCCC"
npm run office -- diff <job-id>
npm run office -- approve <job-id>

# オフライン（スタブ＋fixture）
npm run office -- enqueue "https://example.com/a" --job-id demo-a
npm run office -- ingest --fixture --stub-ai --silent

# 回答（Wiki 根拠・出典検証）
npm run office -- ask "LLM Wiki とは？" --stub-ai --silent
npm run office -- answer <ask-id>

# ダッシュボード（http://127.0.0.1:3847）
npm run office -- serve
npm run office -- serve --port 4000
```

前提: 実URL取得には `yt-dlp`。通知オフは `AI_OFFICE_NOTIFY=0`。launchd は用意のみ。

## ディレクトリ

```
agents/          # 要約・統合・回答の AGENT.md
skills/          # Wiki / Source 書式と検証スキル
src/pipeline/    # 取得・下ごしらえ・検証・反映（プログラム）
src/retrieval/   # 回答用候補探し・出典検証
src/runner/      # ノード実行・claude -p 呼び出し
src/dashboard/   # Express API（office serve）
dashboard/       # 静的 UI（OFFICE/QUEUE/ASK/REVIEW/KNOWLEDGE/USAGE）
fixtures/        # 公開用ダミー保管庫
vendor/ecc/      # ECC から選んだ最小部品（common + typescript rules + 開発スキル）
ops/launchd/     # 定時実行の設定（用意だけ・読み込ませない）
docs/adr/        # 設計判断
```

## ドキュメント

- [デモ手順](docs/DEMO.md)
- [ADR 一覧](docs/adr/README.md)
- [SECURITY](SECURITY.md)

```bash
npm test
npm run publish:scan
npm run demo:smoke
```

## ライセンス

MIT — see [LICENSE](LICENSE).
