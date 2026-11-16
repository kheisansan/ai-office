# Demo (sample vault)

録画用の最短コース。**実保管庫は使わない。**

## 1. オフライン一周（推奨）

```bash
npm install
./scripts/demo-smoke.sh
```

成功すると `demo/out/vault` に反映済み Wiki、`demo/out/data` にジョブが残る。

## 2. ダッシュボード

```bash
VAULT_PATH="$PWD/demo/out/vault" DATA_DIR="$PWD/demo/out/data" AI_MODE=stub \
  npm run office -- serve
```

ブラウザで `http://127.0.0.1:3847` → OFFICE / QUEUE / ASK / REVIEW / USAGE を見せる。

## 3. 録画で見せたい流れ

1. URL をキューに積む → 今すぐ実行（stub）→ REVIEW で承認
2. ASK で「LLM Wiki とは？」→ 出典付き回答
3. USAGE でトークン（stub では 0 でも画面があることを示す）

実 Claude（`AI_MODE=claude`）で回す場合は Pro 枠を消費する。ポートフォリオ撮影前に `npm run publish:scan` を通すこと。
