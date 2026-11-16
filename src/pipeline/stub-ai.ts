import fs from "node:fs";
import path from "node:path";
import { readJson, writeText } from "../lib/fsutil.js";
import { listWikiCategories } from "../lib/wiki-layout.js";

type Metadata = { title: string; url: string };

function listWikiBasenames(vaultPath: string | undefined): Set<string> {
  const names = new Set<string>();
  if (!vaultPath) return names;
  const wikiRoot = path.join(vaultPath, "Wiki");
  if (!fs.existsSync(wikiRoot)) return names;

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) names.add(path.basename(entry.name, ".md"));
    }
  };
  walk(wikiRoot);
  return names;
}

/** Phase 0/1 stand-in for summarizer AI (no tokens). */
export function stubSummarize(jobDir: string): string {
  const meta = readJson<Metadata>(path.join(jobDir, "raw", "metadata.json"));
  const today = new Date().toISOString().slice(0, 10);
  const slug =
    meta.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "source";
  const out = path.join(jobDir, "draft", "Sources", "Videos", `${slug}.md`);
  writeText(
    out,
    `---
tags: [source, video]
related: []
status: draft
created: ${today}
updated: ${today}
source_url: ${meta.url}
---

# ${meta.title}

## 要約
- AI office combines agents, files, and human approval.
- Roles should be narrow; pass state via files.

## 事実
- 動画で述べられている: agents + files + human approval.

## 意見・推論
- 推論: 少人数のエージェント構成が運用コストを下げる。

## 不明・聞き取れず
- なし（fixture）

## Sources
- ${meta.url}
`,
  );
  return out;
}

/** Phase 0/1 stand-in for integrator AI (no tokens). */
export function stubIntegrate(
  jobDir: string,
  options: { pageName?: string; vaultPath?: string; attempt?: number } = {},
): string {
  const pageName = options.pageName ?? "AIオフィス";
  const today = new Date().toISOString().slice(0, 10);
  const existing = listWikiBasenames(options.vaultPath);
  const failFirst =
    process.env.AI_OFFICE_STUB_FAIL_FIRST_INTEGRATE === "1" &&
    (options.attempt ?? 1) <= 1;
  // Prefer a known sample-vault page when present; otherwise no related links.
  const related = failFirst
    ? `["[[__missing_for_retry_test__]]"]`
    : existing.has("LLM Wiki")
      ? `["[[LLM Wiki]]"]`
      : existing.has("ハーネスエンジニアリング")
        ? `["[[ハーネスエンジニアリング]]"]`
        : "[]";

  const cats = listWikiCategories(options.vaultPath ?? "");
  const category =
    cats.find((c) => c.name === "AI")?.name ?? cats[0]?.name ?? "AI";
  const wikiPath = path.join(
    jobDir,
    "draft",
    "Wiki",
    category,
    `${pageName}.md`,
  );
  writeText(
    wikiPath,
    `---
tags: [AI, エージェント]
related: ${related}
status: active
created: ${today}
updated: ${today}
---

# ${pageName}

エージェント・ファイル受け渡し・人の承認で知識管理を回す構成。

## Sources
- draft Source note from this job
`,
  );
  writeText(
    path.join(jobDir, "draft", "index.patch"),
    `- [[${pageName}]] — エージェント型の知識管理オフィス\n`,
  );
  writeText(
    path.join(jobDir, "draft", "log.patch"),
    `- [INGEST] ${today}: stub integrated [[${pageName}]]\n`,
  );
  return wikiPath;
}

/** Phase 3 stand-in for answerer AI (no tokens). */
export function stubAnswer(
  answerDir: string,
  question: string,
  candidateIds: string[],
  options: { attempt?: number } = {},
): string {
  const primary = candidateIds[0];
  const today = new Date().toISOString().slice(0, 10);
  const failFirst =
    process.env.AI_OFFICE_STUB_FAIL_FIRST_ANSWER === "1" &&
    (options.attempt ?? 1) <= 1;

  let body: string;
  if (failFirst) {
    // Intentionally bad: claim without citation + forbidden external URL
    body = [
      "## 答え",
      "",
      "これは出典なしの主張で、さらに https://example.com を根拠にしている。",
      "",
      "## Wiki で一部しか分からないこと",
      "",
      "なし",
      "",
      "## Wiki に情報がないこと",
      "- 何が足りないか: （リトライ用フィクスチャ）",
      "- 推奨する調べ方: n/a",
      "- 取り込み候補: n/a",
      "",
      "## 参照したページ",
      "- （なし）",
      "",
    ].join("\n");
  } else if (!primary) {
    body = [
      "## 答え",
      "",
      "Wiki に情報がない。",
      "",
      "## Wiki で一部しか分からないこと",
      "",
      "なし",
      "",
      "## Wiki に情報がないこと",
      `- 何が足りないか: 「${question}」に直接答える記述`,
      "- 推奨する調べ方: 公式ドキュメント / GitHub README / 関連動画の字幕",
      "- 取り込み候補: 公式 docs か解説記事の URL をキューへ",
      "",
      "## 参照したページ",
      "- （なし）",
      "",
    ].join("\n");
  } else {
    const refs = candidateIds.map((id) => `- [[${id}]]`).join("\n");
    body = [
      "## 答え",
      "",
      `質問「${question}」について、Wiki 上の関連記述は [[${primary}]] を中心にまとまっている。[[${primary}]]`,
      "",
      "## Wiki で一部しか分からないこと",
      "",
      `詳細な数値や最新版の差分は、候補ページだけでは足りない場合がある。[[${primary}]]`,
      "",
      "## Wiki に情報がないこと",
      "- 何が足りないか: 質問の周辺で Wiki に未取り込みの一次情報",
      "- 推奨する調べ方: 日本語・英語の公式ドキュメントと GitHub",
      "- 取り込み候補: 公式 docs / 解説動画",
      "",
      "## 参照したページ",
      refs,
      "",
    ].join("\n");
  }

  const out = path.join(answerDir, "answer.md");
  writeText(out, body);
  writeText(
    path.join(answerDir, "draft", "ingest-suggestions.md"),
    [
      "# 取り込み候補",
      "",
      `- 質問: ${question}`,
      `- 日付: ${today}`,
      "- 候補: 公式ドキュメント / 解説動画（スタブ）",
      "",
    ].join("\n"),
  );
  writeText(
    path.join(answerDir, "draft", "append-proposal.md"),
    [
      "# 追記提案（未承認・Vault 未反映）",
      "",
      `- 質問: ${question}`,
      `- 日付: ${today}`,
      "",
      "## 提案",
      "",
      primary
        ? `- [[${primary}]] に、質問に対する短い FAQ 節を足す案（人が確認してから）`
        : "- （候補なしのため追記先なし）",
      "",
    ].join("\n"),
  );
  return out;
}
