import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeJson, writeText } from "../../src/lib/fsutil.js";
import {
  ensureWikiCategoriesFile,
  syncWikiCategoriesFromVault,
} from "../../src/lib/wiki-layout.js";
import { applyDraft } from "../../src/pipeline/apply.js";
import { fetchSource } from "../../src/pipeline/fetch.js";
import { prepareTranscript } from "../../src/pipeline/prepare.js";
import { stubIntegrate, stubSummarize } from "../../src/pipeline/stub-ai.js";
import { verifyDraft } from "../../src/pipeline/verify.js";

function seedVault(vault: string, categories: string[]): void {
  for (const id of categories) {
    fs.mkdirSync(path.join(vault, "Wiki", id), { recursive: true });
  }
  writeJson(path.join(vault, "_schema", "wiki-categories.json"), {
    version: 1,
    updatedAt: new Date().toISOString(),
    categories: categories.map((id) => ({ id, description: "" })),
  });
  writeText(
    path.join(vault, "Wiki", categories[0] ?? "AI", "LLM Wiki.md"),
    "---\ntags: []\nrelated: []\nstatus: active\ncreated: 2026-11-16\nupdated: 2026-11-16\n---\n\n# LLM Wiki\n",
  );
  writeText(path.join(vault, "index.md"), "# Index\n");
  writeText(path.join(vault, "log.md"), "# Log\n");
}

describe("wiki category harness", () => {
  it("seeds harness file from folders when missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-h-"));
    fs.mkdirSync(path.join(root, "Wiki", "AI"), { recursive: true });
    fs.mkdirSync(path.join(root, "Wiki", "Tech"), { recursive: true });
    const file = ensureWikiCategoriesFile(root);
    expect(file.categories.map((c) => c.id)).toEqual(["AI", "Tech"]);
    expect(fs.existsSync(path.join(root, "_schema", "wiki-categories.json"))).toBe(
      true,
    );
  });

  it("fails verify for Wiki-root md, allows new valid category", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-h-"));
    const vault = path.join(root, "vault");
    const jobDir = path.join(root, "job");
    seedVault(vault, ["AI"]);

    writeText(
      path.join(jobDir, "draft", "Sources", "Videos", "s.md"),
      "---\ntags: []\nrelated: []\nstatus: draft\ncreated: 2026-11-16\nupdated: 2026-11-16\n---\n\n# s\n",
    );
    writeText(
      path.join(jobDir, "draft", "Wiki", "bad-root.md"),
      "---\ntags: []\nrelated: []\nstatus: active\ncreated: 2026-11-16\nupdated: 2026-11-16\n---\n\n# bad\n",
    );
    writeText(path.join(jobDir, "draft", "index.patch"), "- x\n");
    writeText(path.join(jobDir, "draft", "log.patch"), "- x\n");
    expect(verifyDraft(jobDir, vault).ok).toBe(false);

    // replace with new category Design
    fs.rmSync(path.join(jobDir, "draft", "Wiki"), { recursive: true, force: true });
    writeText(
      path.join(jobDir, "draft", "Wiki", "Design", "new-page.md"),
      "---\ntags: []\nrelated: [\"[[LLM Wiki]]\"]\nstatus: active\ncreated: 2026-11-16\nupdated: 2026-11-16\n---\n\n# new\n\n## Sources\n- s\n",
    );
    writeText(path.join(jobDir, "draft", "index.patch"), "- [[new-page]]\n");
    writeText(path.join(jobDir, "draft", "log.patch"), "- x\n");
    const checks = verifyDraft(jobDir, vault);
    expect(checks.ok).toBe(true);
    expect(checks.checks.some((c) => c.id === "wiki-category-new:Design")).toBe(
      true,
    );
  });

  it("apply registers new category into harness list", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-h-"));
    const vault = path.join(root, "vault");
    const jobDir = path.join(root, "job");
    seedVault(vault, ["AI"]);

    await fetchSource({
      jobDir,
      url: "https://example.com/x",
      fixtureTitle: "Cat Test",
      fixtureTranscript: "00:00 hi\n",
    });
    prepareTranscript(jobDir);
    stubSummarize(jobDir);
    // manually place under new category instead of stub default
    fs.rmSync(path.join(jobDir, "draft", "Wiki"), { recursive: true, force: true });
    writeText(
      path.join(jobDir, "draft", "Wiki", "Design", "design-note.md"),
      "---\ntags: []\nrelated: [\"[[LLM Wiki]]\"]\nstatus: active\ncreated: 2026-11-16\nupdated: 2026-11-16\n---\n\n# design\n\n## Sources\n- x\n",
    );
    writeText(path.join(jobDir, "draft", "index.patch"), "- [[design-note]]\n");
    writeText(path.join(jobDir, "draft", "log.patch"), "- [INGEST]\n");
    writeJson(path.join(jobDir, "approval.json"), {
      decision: "approve",
      comment: "test",
      decidedAt: new Date().toISOString(),
    });

    expect(verifyDraft(jobDir, vault).ok).toBe(true);
    applyDraft(jobDir, vault);

    expect(fs.existsSync(path.join(vault, "Wiki", "Design", "design-note.md"))).toBe(
      true,
    );
    const synced = syncWikiCategoriesFromVault(vault);
    const ids = JSON.parse(
      fs.readFileSync(path.join(vault, "_schema", "wiki-categories.json"), "utf8"),
    ).categories.map((c: { id: string }) => c.id);
    expect(ids).toContain("Design");
    expect(ids).toContain("AI");
    expect(synced.file.categories.some((c) => c.id === "Design")).toBe(true);
  });

  it("stubIntegrate places under AI when harness has AI", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-h-"));
    const vault = path.join(root, "vault");
    const jobDir = path.join(root, "job");
    seedVault(vault, ["AI"]);
    await fetchSource({
      jobDir,
      url: "https://example.com/x",
      fixtureTitle: "Cat Test",
      fixtureTranscript: "00:00 hi\n",
    });
    prepareTranscript(jobDir);
    stubSummarize(jobDir);
    stubIntegrate(jobDir, { vaultPath: vault });
    expect(
      fs.existsSync(path.join(jobDir, "draft", "Wiki", "AI", "AIオフィス.md")),
    ).toBe(true);
  });
});
