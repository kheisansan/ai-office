import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeJson } from "../../src/lib/fsutil.js";
import { applyDraft } from "../../src/pipeline/apply.js";
import { fetchSource } from "../../src/pipeline/fetch.js";
import { prepareTranscript } from "../../src/pipeline/prepare.js";
import { stubIntegrate, stubSummarize } from "../../src/pipeline/stub-ai.js";
import { verifyDraft } from "../../src/pipeline/verify.js";

async function seedJob(jobDir: string): Promise<void> {
  await fetchSource({
    jobDir,
    url: "https://example.com/demo",
    fixtureTitle: "AI Office Demo Video",
    fixtureTranscript: "00:00 agents and files\n01:00 human approval\n",
  });
  prepareTranscript(jobDir);
  stubSummarize(jobDir);
  stubIntegrate(jobDir);
}

function approve(jobDir: string): void {
  writeJson(path.join(jobDir, "approval.json"), {
    decision: "approve",
    comment: "test",
    decidedAt: new Date().toISOString(),
  });
}

describe("verify + apply", () => {
  it("passes checks and applies into a temp vault", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-"));
    const jobDir = path.join(root, "job");
    const vaultPath = path.join(root, "vault");
    fs.mkdirSync(path.join(vaultPath, "Wiki", "AI"), { recursive: true });
    fs.mkdirSync(path.join(vaultPath, "_schema"), { recursive: true });
    fs.writeFileSync(
      path.join(vaultPath, "_schema", "wiki-categories.json"),
      JSON.stringify({
        version: 1,
        categories: [{ id: "AI", description: "AI" }],
      }) + "\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(vaultPath, "Wiki", "AI", "LLM Wiki.md"),
      "---\ntags: []\nrelated: []\nstatus: active\ncreated: 2026-11-16\nupdated: 2026-11-16\n---\n\n# LLM Wiki\n",
      "utf8",
    );
    fs.writeFileSync(path.join(vaultPath, "index.md"), "# Index\n", "utf8");
    fs.writeFileSync(path.join(vaultPath, "log.md"), "# Log\n", "utf8");

    await seedJob(jobDir);
    const checks = verifyDraft(jobDir, vaultPath);
    expect(checks.ok).toBe(true);

    approve(jobDir);
    applyDraft(jobDir, vaultPath);
    expect(fs.existsSync(path.join(vaultPath, "Wiki", "AI", "AIオフィス.md"))).toBe(true);
    expect(fs.readFileSync(path.join(vaultPath, "index.md"), "utf8")).toContain("AIオフィス");
    expect(fs.readFileSync(path.join(vaultPath, "log.md"), "utf8")).toContain("[INGEST]");
  });

  it("rejects OpenClaw paths on apply (case-insensitive)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-"));
    const jobDir = path.join(root, "job");
    const vaultPath = path.join(root, "vault");
    fs.mkdirSync(vaultPath, { recursive: true });
    await seedJob(jobDir);
    approve(jobDir);
    fs.mkdirSync(path.join(jobDir, "draft", "openclaw"), { recursive: true });
    fs.writeFileSync(path.join(jobDir, "draft", "openclaw", "secret.md"), "nope\n");

    expect(() => applyDraft(jobDir, vaultPath)).toThrow(/OpenClaw/i);
  });

  it("rejects apply without approval", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-"));
    const jobDir = path.join(root, "job");
    const vaultPath = path.join(root, "vault");
    fs.mkdirSync(vaultPath, { recursive: true });
    await seedJob(jobDir);
    expect(() => applyDraft(jobDir, vaultPath)).toThrow(/approval/);
  });
});
