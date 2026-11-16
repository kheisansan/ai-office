import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/lib/config.js";
import { REPO_ROOT } from "../../src/lib/paths.js";
import { verifyCitations } from "../../src/retrieval/citations.js";
import { findCandidates } from "../../src/retrieval/search.js";
import { runAsk } from "../../src/runner/ask.js";

function tempConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-ask-"));
  const vaultPath = path.join(root, "vault");
  const dataDir = path.join(root, "data");
  fs.cpSync(path.join(REPO_ROOT, "fixtures/sample-vault"), vaultPath, {
    recursive: true,
  });
  return loadConfig({
    vaultPath,
    dataDir,
    aiMode: "stub",
  });
}

afterEach(() => {
  delete process.env.AI_OFFICE_STUB_FAIL_FIRST_ANSWER;
  process.env.AI_OFFICE_NOTIFY = "0";
});

describe("phase3 retrieval + ask", () => {

  it("accepts japanese question without --ask-id", async () => {
    process.env.AI_OFFICE_NOTIFY = "0";
    const config = tempConfig();
    const result = await runAsk(config, {
      question: "LLM Wikiとは？",
      aiMode: "stub",
      silent: true,
      skipLogAppend: true,
    });
    expect(result.state.id).toMatch(/^ask-[a-z0-9.-]+$/);
    expect(result.checksOk).toBe(true);
  });


  it("matches japanese question to harness page via prefix", () => {
    const config = tempConfig();
    const hits = findCandidates(config.vaultPath, "ハーネスって何？", 5);
    expect(hits.candidates.some((c) => c.id === "ハーネスエンジニアリング")).toBe(true);
  });

  it("finds Wiki candidates by title/body tokens", () => {
    const config = tempConfig();
    const hits = findCandidates(config.vaultPath, "LLM Wiki の根拠", 5);
    expect(hits.candidates.length).toBeGreaterThan(0);
    expect(hits.candidates.some((c) => c.id === "LLM Wiki")).toBe(true);
  });

  it("verifyCitations rejects empty ## 答え", () => {
    const empty = `## 答え

## Wiki に情報がないこと
- なし

## 参照したページ
- （なし）
`;
    const checks = verifyCitations(empty, []);
    expect(checks.ok).toBe(false);
    expect(checks.checks.some((c) => c.id === "section:## 答え:nonempty" && !c.ok)).toBe(
      true,
    );
  });

  it("requires sourceUrl in 参照したページ for source candidates", () => {
    const cand = {
      id: "YT-demo",
      path: "",
      relPath: "Sources/Videos/YT-demo.md",
      title: "YT demo",
      score: 1,
      reasons: [],
      excerpts: [],
      kind: "source" as const,
      sourceUrl: "https://youtu.be/demo123",
    };
    const missingUrl = `## 答え

要約。[[YT-demo]]

## Wiki に情報がないこと
- なし

## 参照したページ
- [[YT-demo]]
`;
    expect(verifyCitations(missingUrl, [cand]).ok).toBe(false);

    const withUrl = `## 答え

要約。[[YT-demo]]

## Wiki に情報がないこと
- なし

## 参照したページ
- [[YT-demo]] — https://youtu.be/demo123
`;
    expect(verifyCitations(withUrl, [cand]).ok).toBe(true);
  });

  it("prefers Wiki over Sources when basenames collide", () => {
    const config = tempConfig();
    const sourcesDir = path.join(config.vaultPath, "Sources", "Articles");
    fs.mkdirSync(sourcesDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourcesDir, "LLM Wiki.md"),
      "---\ntags: [source]\nrelated: []\nstatus: draft\ncreated: 2026-11-16\nupdated: 2026-11-16\n---\n\n# LLM Wiki\n\nsource-only body about LLM Wiki\n",
      "utf8",
    );
    const hits = findCandidates(config.vaultPath, "LLM Wiki", 5);
    const hit = hits.candidates.find((c) => c.id === "LLM Wiki");
    expect(hit).toBeTruthy();
    expect(hit!.relPath.startsWith("Wiki/")).toBe(true);
  });

  it("verifyCitations rejects uncited claims and external URLs", () => {
    const bad = `## 答え

出典なしの主張。

## Wiki に情報がないこと
- なし

## 参照したページ
- （なし）
`;
    const wikiCand = {
      id: "LLM Wiki",
      path: "",
      relPath: "Wiki/AI/LLM Wiki.md",
      title: "LLM Wiki",
      score: 1,
      reasons: [],
      excerpts: [],
      kind: "wiki" as const,
    };
    const checks = verifyCitations(bad, [wikiCand]);
    expect(checks.ok).toBe(false);

    const withUrl = `## 答え

これは https://example.com を根拠にしている。[[LLM Wiki]]

## Wiki に情報がないこと
- なし

## 参照したページ
- [[LLM Wiki]]
`;
    expect(verifyCitations(withUrl, [{ ...wikiCand, title: "x" }]).ok).toBe(false);
  });

  it("runAsk stub answers with citations and appends QUERY log", async () => {
    process.env.AI_OFFICE_NOTIFY = "0";
    const config = tempConfig();
    const before = fs.readFileSync(path.join(config.vaultPath, "log.md"), "utf8");

    const result = await runAsk(config, {
      question: "LLM Wiki とは何ですか",
      askId: "ask-llm-wiki",
      aiMode: "stub",
      silent: true,
    });

    expect(result.checksOk).toBe(true);
    expect(result.state.stage).toBe("done");
    expect(result.candidates.candidates.length).toBeGreaterThan(0);
    expect(fs.existsSync(result.answerPath)).toBe(true);
    expect(fs.existsSync(path.join(result.answerDir, "draft", "ingest-suggestions.md"))).toBe(true);
    expect(fs.existsSync(path.join(result.answerDir, "draft", "append-proposal.md"))).toBe(true);

    const after = fs.readFileSync(path.join(config.vaultPath, "log.md"), "utf8");
    expect(after.length).toBeGreaterThan(before.length);
    expect(after).toContain("[QUERY]");
    expect(after).toContain("LLM Wiki");
  });

  it("retries answer once when stub fails first citation check", async () => {
    process.env.AI_OFFICE_NOTIFY = "0";
    process.env.AI_OFFICE_STUB_FAIL_FIRST_ANSWER = "1";
    const config = tempConfig();
    const result = await runAsk(config, {
      question: "ハーネスエンジニアリングの要点",
      askId: "ask-retry",
      aiMode: "stub",
      silent: true,
    });
    expect(result.checksOk).toBe(true);
    expect(result.state.answerAttempts).toBe(2);
    expect(result.state.stage).toBe("done");
    expect(fs.existsSync(path.join(result.answerDir, "citation-feedback.md"))).toBe(true);
  });


  it("skips OpenClaw pages in candidates and context staging", () => {
    const config = tempConfig();
    const oc = path.join(config.vaultPath, "Wiki", "OpenClaw");
    fs.mkdirSync(oc, { recursive: true });
    fs.writeFileSync(
      path.join(oc, "secret.md"),
      "---\ntags: []\nrelated: []\nstatus: active\ncreated: 2026-11-16\nupdated: 2026-11-16\n---\n\n# secret\n\nOpenClaw secret about LLM Wiki\n",
      "utf8",
    );
    const hits = findCandidates(config.vaultPath, "OpenClaw secret LLM Wiki", 8);
    expect(hits.candidates.every((c) => !c.relPath.toLowerCase().includes("openclaw"))).toBe(
      true,
    );
  });

  it("does not double-append QUERY for same askId", async () => {
    process.env.AI_OFFICE_NOTIFY = "0";
    const config = tempConfig();
    await runAsk(config, {
      question: "LLM Wiki とは",
      askId: "ask-once",
      aiMode: "stub",
      silent: true,
    });
    const mid = fs.readFileSync(path.join(config.vaultPath, "log.md"), "utf8");
    const count1 = (mid.match(/\[QUERY\]/g) ?? []).length;
    await runAsk(config, {
      question: "LLM Wiki とは",
      askId: "ask-once",
      aiMode: "stub",
      silent: true,
    });
    const after = fs.readFileSync(path.join(config.vaultPath, "log.md"), "utf8");
    const count2 = (after.match(/\[QUERY\]/g) ?? []).length;
    expect(count2).toBe(count1);
  });

  it("handles no-candidate questions without failing citation shape", async () => {
    process.env.AI_OFFICE_NOTIFY = "0";
    const config = tempConfig();
    const result = await runAsk(config, {
      question: "zzzznonexistent-topic-xyz-999",
      askId: "ask-empty",
      aiMode: "stub",
      silent: true,
      skipLogAppend: true,
    });
    // may still match weakly; if no candidates, stub still produces valid shape
    expect(result.state.stage === "done" || result.state.stage === "needs_human").toBe(true);
    if (result.candidates.candidates.length === 0) {
      expect(result.checksOk).toBe(true);
      expect(result.state.stage).toBe("done");
    }
  });
});
