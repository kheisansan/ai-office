import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  gapTopics,
  listQueueJobs,
  summarizeUsage,
  wikiStats,
} from "../../src/dashboard/aggregate.js";
import { loadConfig } from "../../src/lib/config.js";
import { writeJson, writeText } from "../../src/lib/fsutil.js";
import { REPO_ROOT } from "../../src/lib/paths.js";

function tempVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-dash-"));
  const vaultPath = path.join(root, "vault");
  const dataDir = path.join(root, "data");
  fs.cpSync(path.join(REPO_ROOT, "fixtures/sample-vault"), vaultPath, {
    recursive: true,
  });
  return {
    root,
    vaultPath,
    dataDir,
    config: loadConfig({ vaultPath, dataDir, aiMode: "stub" }),
  };
}

describe("dashboard aggregate", () => {
  it("summarizes wiki stats from sample vault", () => {
    const { vaultPath } = tempVault();
    const stats = wikiStats(vaultPath);
    expect(stats.pageCount).toBeGreaterThan(0);
    expect(stats.byCategory.some((c) => c.name === "AI")).toBe(true);
  });

  it("aggregates usage events by kind and week", () => {
    const { config, dataDir } = tempVault();
    const usageDir = path.join(dataDir, "queue", "job-a", "usage");
    writeJson(path.join(usageDir, "summarize.json"), {
      step: "summarize",
      at: new Date().toISOString(),
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    writeJson(path.join(dataDir, "answers", "ask-a", "usage", "answer-1.json"), {
      step: "answer-1",
      at: new Date().toISOString(),
      usage: { input_tokens: 50, output_tokens: 10 },
    });
    const summary = summarizeUsage({
      ...config,
      weeklyIngestTokenBudget: 1000,
      weeklyAskTokenBudget: 500,
    });
    expect(summary.weekIngest).toBe(120);
    expect(summary.weekAsk).toBe(60);
    expect(summary.events).toHaveLength(2);
  });

  it("extracts gap topics from answers mentioning missing wiki info", () => {
    const { config, dataDir } = tempVault();
    const askDir = path.join(dataDir, "answers", "ask-gap");
    writeJson(path.join(askDir, "state.json"), {
      id: "ask-gap",
      stage: "done",
      question: "存在しないトピックは？",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    writeText(
      path.join(askDir, "answer.md"),
      `## 答え\n\nWiki に情報がない。\n\n## Wiki に情報がないこと\n- 何が足りないか: 全部\n\n## 参照したページ\n- （なし）\n`,
    );
    const gaps = gapTopics(config);
    expect(gaps.some((g) => g.askId === "ask-gap")).toBe(true);
  });

  it("heals integrated stage to awaiting_approval when checks ok", () => {
    const { config, dataDir } = tempVault();
    const jobDir = path.join(dataDir, "queue", "stuck-int");
    writeJson(path.join(jobDir, "state.json"), {
      id: "stuck-int",
      stage: "integrated",
      request: {
        id: "stuck-int",
        url: "https://example.com/x",
        createdAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    });
    writeJson(path.join(jobDir, "checks.json"), {
      ok: true,
      checks: [],
      verifiedAt: new Date().toISOString(),
    });
    const jobs = listQueueJobs(config);
    const hit = jobs.find((j) => j.id === "stuck-int");
    expect(hit?.stage).toBe("awaiting_approval");
  });
});
