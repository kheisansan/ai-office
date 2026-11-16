import fs from "node:fs";
import path from "node:path";
import { pathHasOpenClaw, writeJson } from "../lib/fsutil.js";
import {
  draftWikiCategories,
  ensureWikiCategoriesFile,
  isValidCategoryId,
  listHarnessCategories,
} from "../lib/wiki-layout.js";
import type { CheckResult, ChecksFile } from "./types.js";

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdownFiles(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function hasFrontmatter(text: string): boolean {
  return /^---\n[\s\S]*?\n---\n/.test(text);
}

function collectPageNames(...roots: string[]): Set<string> {
  const names = new Set<string>();
  for (const root of roots) {
    for (const f of listMarkdownFiles(root)) {
      names.add(path.basename(f, ".md"));
    }
  }
  return names;
}

export function verifyDraft(jobDir: string, vaultPath: string): ChecksFile {
  const checks: CheckResult[] = [];
  const draftDir = path.join(jobDir, "draft");

  const mdFiles = [
    ...listMarkdownFiles(path.join(draftDir, "Sources")),
    ...listMarkdownFiles(path.join(draftDir, "Wiki")),
  ];
  checks.push({
    id: "draft-exists",
    ok: mdFiles.length > 0,
    message: mdFiles.length > 0 ? `${mdFiles.length} draft md files` : "no draft markdown",
  });

  for (const file of mdFiles) {
    const rel = path.relative(jobDir, file);
    if (pathHasOpenClaw(file)) {
      checks.push({ id: `openclaw:${rel}`, ok: false, message: "OpenClaw path" });
    }
    if (file.endsWith(".patch")) continue;
    const text = fs.readFileSync(file, "utf8");
    checks.push({
      id: `frontmatter:${rel}`,
      ok: hasFrontmatter(text),
      message: hasFrontmatter(text) ? "frontmatter ok" : "missing frontmatter",
    });
  }

  const indexPatch = path.join(draftDir, "index.patch");
  const logPatch = path.join(draftDir, "log.patch");
  checks.push({
    id: "index-patch",
    ok: fs.existsSync(indexPatch) && fs.statSync(indexPatch).size > 0,
    message: "index.patch present",
  });
  checks.push({
    id: "log-patch",
    ok: fs.existsSync(logPatch) && fs.statSync(logPatch).size > 0,
    message: "log.patch present",
  });

  // Harness categories: pages must live under a category folder (existing or new valid id).
  ensureWikiCategoriesFile(vaultPath);
  const harnessIds = new Set(listHarnessCategories(vaultPath).map((c) => c.id));
  const draftWikiRoot = path.join(draftDir, "Wiki");
  if (fs.existsSync(draftWikiRoot)) {
    for (const entry of fs.readdirSync(draftWikiRoot, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        checks.push({
          id: `wiki-category-root:${entry.name}`,
          ok: false,
          message: `Wiki page must be under a category folder (draft/Wiki/<Category>/${entry.name}), not Wiki root`,
        });
      }
      if (entry.isDirectory()) {
        if (!isValidCategoryId(entry.name)) {
          checks.push({
            id: `wiki-category-invalid:${entry.name}`,
            ok: false,
            message: `Invalid category id "${entry.name}"`,
          });
        } else if (!harnessIds.has(entry.name)) {
          checks.push({
            id: `wiki-category-new:${entry.name}`,
            ok: true,
            message: `new category "${entry.name}" (will be registered in harness on approve)`,
          });
        } else {
          checks.push({
            id: `wiki-category-known:${entry.name}`,
            ok: true,
            message: `category "${entry.name}" in harness`,
          });
        }
      }
    }
    if (listMarkdownFiles(draftWikiRoot).length > 0 && draftWikiCategories(jobDir).length === 0) {
      checks.push({
        id: "wiki-category-missing",
        ok: false,
        message: "Wiki drafts exist but no category folder was used",
      });
    }
  }

  const pageNames = collectPageNames(
    path.join(vaultPath, "Wiki"),
    path.join(vaultPath, "Sources"),
    path.join(draftDir, "Wiki"),
    path.join(draftDir, "Sources"),
  );

  const linkRe = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  for (const file of mdFiles) {
    if (file.endsWith(".patch")) continue;
    const text = fs.readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(text)) !== null) {
      const name = m[1].trim();
      const ok = pageNames.has(name);
      checks.push({
        id: `link:${path.basename(file)}:${name}`,
        ok,
        message: ok ? `[[${name}]] exists` : `broken link [[${name}]]`,
      });
    }
  }

  const result: ChecksFile = {
    ok: checks.every((c) => c.ok),
    checks,
    verifiedAt: new Date().toISOString(),
  };
  writeJson(path.join(jobDir, "checks.json"), result);
  return result;
}
