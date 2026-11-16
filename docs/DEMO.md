# Demo (sample vault)

録画用の最短コース。**実保管庫は使わない。**

## 1. オフライン一周（推奨）

```bash
npm install
./scripts/demo-smoke.sh
```

成功すると `demo/out/vault` に反映済み Wiki、`demo/out/data` にジョブが残る。

## 2. ダッシュボード（オフィス空間 UI）

```bash
VAULT_PATH="$PWD/demo/out/vault" DATA_DIR="$PWD/demo/out/data" AI_MODE=stub \
  npm run office -- serve
```

ブラウザで `http://127.0.0.1:3847` → 俯瞰オフィスが1画面で出る。

## 3. 録画で見せたい流れ（クリック操作）

1. **取り込み担当**をクリック → URL を入れて「キューに積む」→「今すぐ実行」（stub）→ キャラが busy ランプになる
2. **掲示板**をクリック → 承認待ち diff を見て承認（ランプが needs_you → idle）
3. **回答担当**をクリック → 「LLM Wiki とは？」→ 出典付き回答
4. **モニター**をクリック → QUEUE カンバン要約 + USAGE + Wiki 統計

実 Claude（`AI_MODE=claude`）で回す場合は Pro 枠を消費する。ポートフォリオ撮影前に `npm run publish:scan` を通すこと。
