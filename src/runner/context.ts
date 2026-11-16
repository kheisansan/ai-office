import fs from "node:fs";
import path from "node:path";
import { ensureDir, pathHasOpenClaw, writeJson, writeText } from "../lib/fsutil.js";
import {
  ensureWikiCategoriesFile,
  listWikiCategories,
  type WikiCategoryInfo,
} from "../lib/wiki-layout.js";

function writeWikiLayoutDoc(contextDir: string, cats: WikiCategoryInfo[]): void {
  const lines = [
    "# Wiki categories (harness)",
    "",
    "正本: 保管庫 `_schema/wiki-categories.json`（ハーネス管理。AIは編集しない）。",
    "",
    "配置ルール:",
    "- 必須: `draft/Wiki/<Category>/<page>.md`",
    "- 禁止: `draft/Wiki/<page>.md`（直下）",
    "- 既存カテゴリに当てはまるならそれを使う",
    "- 当てはまらなければ **新しい Category 名** でフォルダを作ってよい",
    "- 新規カテゴリの一覧登録は承認後にプログラムが行う（あなたはフォルダを作るだけ）",
    "",
  ];
  if (cats.length === 0) {
    lines.push("（まだカテゴリなし — 初回は適切な名前で新規作成してよい）", "");
  } else {
    lines.push("## 登録済みカテゴリ", "");
    for (const c of cats) {
      const badge = c.fromHarness ? "harness" : "folder-only";
      const desc = c.description ? ` — ${c.description}` : "";
      lines.push(`### ${c.name} (${c.pageCount}, ${badge})${desc}`);
      for (const p of c.samplePages) lines.push(`- [[${p}]]`);
      lines.push("");
    }
  }
  writeText(path.join(contextDir, "wiki-layout.md"), lines.join("\n"));
  writeJson(path.join(contextDir, "wiki-categories.json"), { categories: cats });
}

/** Copy vault index (+ optional named pages) into jobDir/context for AI read. */
export function stageVaultContext(
  jobDir: string,
  vaultPath: string,
  pageNames: string[] = [],
): string {
  const contextDir = path.join(jobDir, "context");
  ensureDir(contextDir);

  const indexSrc = path.join(vaultPath, "index.md");
  if (fs.existsSync(indexSrc)) {
    fs.copyFileSync(indexSrc, path.join(contextDir, "index.md"));
  } else {
    writeText(path.join(contextDir, "index.md"), "# (no index.md in vault)\n");
  }

  ensureWikiCategoriesFile(vaultPath);
  const cats = listWikiCategories(vaultPath);
  writeWikiLayoutDoc(contextDir, cats);

  const copied: string[] = [];
  if (pageNames.length > 0) {
    const wanted = new Set(pageNames);
    const stageRoot = (rootName: "Wiki" | "Sources"): void => {
      const root = path.join(vaultPath, rootName);
      if (!fs.existsSync(root)) return;
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (pathHasOpenClaw(full)) continue;
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          if (!entry.name.endsWith(".md")) continue;
          const base = path.basename(entry.name, ".md");
          if (!wanted.has(base)) continue;
          const rel = path.relative(root, full);
          const dest = path.join(contextDir, rootName, rel);
          ensureDir(path.dirname(dest));
          fs.copyFileSync(full, dest);
          copied.push(`${rootName}/${rel.replace(/\\/g, "/")}`);
        }
      };
      walk(root);
    };
    stageRoot("Wiki");
    stageRoot("Sources");
  }

  writeText(
    path.join(contextDir, "README.md"),
    [
      "# Read-only vault context",
      "Copied by the program for the integrator. Do not treat as writable vault.",
      "Read `wiki-layout.md` when writing Wiki drafts. For ask, prefer candidates.json.",
      `copiedPages: ${copied.join(", ") || "(index + layout only)"}`,
      "",
    ].join("\n"),
  );

  return contextDir;
}

/** Naive candidate page names from Source draft text / title tokens. */
export function guessCandidatePages(jobDir: string, limit = 8): string[] {
  const sourcesDir = path.join(jobDir, "draft", "Sources");
  const textParts: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) textParts.push(fs.readFileSync(full, "utf8"));
    }
  };
  walk(sourcesDir);
  const blob = textParts.join("\n");
  const links = [...blob.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((m) =>
    m[1].trim(),
  );
  return [...new Set(links)].slice(0, limit);
}
