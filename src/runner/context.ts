import fs from "node:fs";
import path from "node:path";
import {
  assertReadablePathWithin,
  copyFileWithin,
  ensureDir,
  pathHasOpenClaw,
  readTextWithin,
  writeJson,
  writeText,
} from "../lib/fsutil.js";
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
  const indexDest = path.join(contextDir, "index.md");
  if (fs.existsSync(indexSrc)) {
    try {
      assertReadablePathWithin(indexSrc, vaultPath);
      if (fs.lstatSync(indexSrc).isSymbolicLink()) {
        writeText(indexDest, "# (index.md symlink skipped)\n");
      } else {
        copyFileWithin(indexSrc, vaultPath, indexDest, [contextDir]);
      }
    } catch {
      writeText(indexDest, "# (index.md unreadable / outside vault)\n");
    }
  } else {
    writeText(indexDest, "# (no index.md in vault)\n");
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
      let vaultReal: string;
      let rootReal: string;
      try {
        vaultReal = fs.realpathSync(vaultPath);
        rootReal = fs.realpathSync(root);
      } catch {
        return;
      }
      if (!(rootReal === vaultReal || rootReal.startsWith(vaultReal + path.sep))) return;
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (pathHasOpenClaw(full)) continue;
          if (entry.isSymbolicLink()) {
            try {
              const real = fs.realpathSync(full);
              if (pathHasOpenClaw(real)) continue;
              if (!(real === vaultReal || real.startsWith(vaultReal + path.sep))) continue;
              const st = fs.statSync(real);
              if (st.isDirectory()) walk(full);
              else if (entry.name.endsWith(".md")) {
                const base = path.basename(entry.name, ".md");
                if (!wanted.has(base)) continue;
                const rel = path.relative(root, full);
                // Symlink pages: only copy when target stays in vault; never follow as source symlink into context via copyFileSync
                const dest = path.join(contextDir, rootName, rel);
                try {
                  copyFileWithin(full, vaultPath, dest, [contextDir]);
                  copied.push(`${rootName}/${rel.replace(/\\/g, "/")}`);
                } catch {
                  /* skip unsafe */
                }
              }
            } catch {
              /* skip */
            }
            continue;
          }
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          if (!entry.name.endsWith(".md")) continue;
          const base = path.basename(entry.name, ".md");
          if (!wanted.has(base)) continue;
          const rel = path.relative(root, full);
          const dest = path.join(contextDir, rootName, rel);
          try {
            copyFileWithin(full, vaultPath, dest, [contextDir]);
            copied.push(`${rootName}/${rel.replace(/\\/g, "/")}`);
          } catch {
            /* skip unsafe */
          }
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
  const draftRoot = path.join(jobDir, "draft");
  const sourcesDir = path.join(draftRoot, "Sources");
  const textParts: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      try {
        textParts.push(readTextWithin(full, draftRoot));
      } catch {
        /* skip symlink/hardlink/escape */
      }
    }
  };
  walk(sourcesDir);
  const blob = textParts.join("\n");
  const links = [...blob.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((m) =>
    m[1].trim(),
  );
  return [...new Set(links)].slice(0, limit);
}
