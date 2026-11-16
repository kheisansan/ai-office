import fs from "node:fs";
import path from "node:path";
import {
  assertSafeWriteTarget,
  copyFileWithin,
  ensureDir,
  pathHasOpenClaw,
  readJson,
  readTextWithin,
} from "../lib/fsutil.js";
import type { ApprovalFile } from "./types.js";
import {
  draftWikiCategories,
  syncWikiCategoriesFromVault,
} from "../lib/wiki-layout.js";

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function copyDir(src: string, dest: string, vaultRoot: string, draftRoot: string): void {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    assertSafeWriteTarget(to, [vaultRoot]);
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing symlink in draft: ${from}`);
    }
    if (entry.isDirectory()) copyDir(from, to, vaultRoot, draftRoot);
    else copyFileWithin(from, draftRoot, to, [vaultRoot]);
  }
}

function appendPatch(
  vaultFile: string,
  patchFile: string,
  vaultRoot: string,
  draftRoot: string,
): void {
  if (!fs.existsSync(patchFile)) return;
  assertSafeWriteTarget(vaultFile, [vaultRoot]);
  ensureDir(path.dirname(vaultFile));
  const patch = readTextWithin(patchFile, draftRoot);
  if (fs.existsSync(vaultFile)) {
    fs.appendFileSync(vaultFile, patch.startsWith("\n") ? patch : `\n${patch}`);
  } else {
    fs.writeFileSync(vaultFile, patch, "utf8");
  }
}

/** Apply approved draft into the vault. Program-only; never called by AI. */
export function applyDraft(jobDir: string, vaultPath: string): void {
  const approvalPath = path.join(jobDir, "approval.json");
  if (!fs.existsSync(approvalPath)) {
    throw new Error("Refusing apply without approval.json");
  }
  const approval = readJson<ApprovalFile>(approvalPath);
  if (approval.decision !== "approve") {
    throw new Error(`Refusing apply: decision=${approval.decision}`);
  }

  const draft = path.join(jobDir, "draft");
  for (const file of walkFiles(draft)) {
    if (pathHasOpenClaw(file)) {
      throw new Error(`Refusing path containing OpenClaw: ${file}`);
    }
    if (fs.lstatSync(file).isSymbolicLink()) {
      throw new Error(`Refusing symlink in draft: ${file}`);
    }
  }
  copyDir(path.join(draft, "Sources"), path.join(vaultPath, "Sources"), vaultPath, draft);
  copyDir(path.join(draft, "Wiki"), path.join(vaultPath, "Wiki"), vaultPath, draft);
  appendPatch(
    path.join(vaultPath, "index.md"),
    path.join(draft, "index.patch"),
    vaultPath,
    draft,
  );
  appendPatch(path.join(vaultPath, "log.md"), path.join(draft, "log.patch"), vaultPath, draft);

  // Harness: register any new Wiki categories created by this apply
  syncWikiCategoriesFromVault(vaultPath, draftWikiCategories(jobDir));
}
