import fs from "node:fs";
import path from "node:path";
import {
  assertReadablePathWithin,
  assertSafeWriteTarget,
  ensureDir,
  readJson,
  writeJson,
} from "./fsutil.js";

export type WikiCategory = {
  id: string;
  description?: string;
};

export type WikiCategoriesFile = {
  version: 1;
  updatedAt?: string;
  categories: WikiCategory[];
};

export type WikiCategoryInfo = {
  name: string;
  pageCount: number;
  samplePages: string[];
  description?: string;
  fromHarness: boolean;
};

const FORBIDDEN = new Set(["OpenClaw", ".", ".."]);

/** Category folder name: no path separators; allow unicode letters/numbers/_- */
export function isValidCategoryId(id: string): boolean {
  if (!id || FORBIDDEN.has(id)) return false;
  if (id.includes("/") || id.includes("\\") || id.includes("..")) return false;
  if (id.startsWith(".")) return false;
  return /^[\p{L}\p{N}][\p{L}\p{N}_ -]{0,63}$/u.test(id);
}

export function wikiCategoriesPath(vaultPath: string): string {
  return path.join(vaultPath, "_schema", "wiki-categories.json");
}

export function scanWikiCategoryFolders(vaultPath: string): string[] {
  const wikiRoot = path.join(vaultPath, "Wiki");
  if (!fs.existsSync(wikiRoot)) return [];
  return fs
    .readdirSync(wikiRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isValidCategoryId(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

export function loadWikiCategoriesFile(vaultPath: string): WikiCategoriesFile | null {
  const file = wikiCategoriesPath(vaultPath);
  if (!fs.existsSync(file)) return null;
  try {
    assertReadablePathWithin(file, vaultPath);
  } catch {
    return null;
  }
  if (fs.lstatSync(file).isSymbolicLink()) return null;
  const data = readJson<WikiCategoriesFile>(file);
  if (!data || data.version !== 1 || !Array.isArray(data.categories)) return null;
  return data;
}

function assertWritableCategoriesFile(vaultPath: string): string {
  const file = wikiCategoriesPath(vaultPath);
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error(`Refusing symlink wiki-categories.json: ${file}`);
  }
  assertSafeWriteTarget(file, [vaultPath]);
  return file;
}

/** Ensure harness file exists; seed from Wiki folders if missing. */
export function ensureWikiCategoriesFile(vaultPath: string): WikiCategoriesFile {
  const existing = loadWikiCategoriesFile(vaultPath);
  if (existing) return existing;

  const file = wikiCategoriesPath(vaultPath);
  if (fs.existsSync(file)) {
    // Unreadable (e.g. symlink) — never write-through to the target.
    throw new Error(`Refusing to overwrite unsafe wiki-categories.json: ${file}`);
  }
  const seeded: WikiCategoriesFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    categories: scanWikiCategoryFolders(vaultPath).map((id) => ({
      id,
      description: "",
    })),
  };
  ensureDir(path.dirname(file));
  assertWritableCategoriesFile(vaultPath);
  writeJson(file, seeded);
  return seeded;
}

export function listHarnessCategories(vaultPath: string): WikiCategory[] {
  const file = ensureWikiCategoriesFile(vaultPath);
  return file.categories.filter((c) => isValidCategoryId(c.id));
}

/** List categories for prompts: harness list + live folder stats. */
export function listWikiCategories(vaultPath: string): WikiCategoryInfo[] {
  const harness = listHarnessCategories(vaultPath);
  const byId = new Map(harness.map((c) => [c.id, c]));
  const folders = new Set(scanWikiCategoryFolders(vaultPath));
  const ids = new Set([...byId.keys(), ...folders]);

  const out: WikiCategoryInfo[] = [];
  for (const id of [...ids].sort((a, b) => a.localeCompare(b))) {
    const dir = path.join(vaultPath, "Wiki", id);
    const pages = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => path.basename(n, ".md"))
      : [];
    const h = byId.get(id);
    out.push({
      name: id,
      pageCount: pages.length,
      samplePages: pages.slice(0, 8),
      description: h?.description,
      fromHarness: Boolean(h),
    });
  }
  return out;
}

export function draftWikiCategories(jobDir: string): string[] {
  const root = path.join(jobDir, "draft", "Wiki");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isValidCategoryId(e.name))
    .map((e) => e.name);
}

/**
 * After apply: register any new Wiki category folders into the harness list.
 * Returns newly added category ids.
 */
export function syncWikiCategoriesFromVault(
  vaultPath: string,
  extraIds: string[] = [],
): { added: string[]; file: WikiCategoriesFile } {
  const file = ensureWikiCategoriesFile(vaultPath);
  const known = new Set(file.categories.map((c) => c.id));
  const candidates = [
    ...scanWikiCategoryFolders(vaultPath),
    ...extraIds.filter(isValidCategoryId),
  ];
  const added: string[] = [];
  for (const id of candidates) {
    if (known.has(id)) continue;
    file.categories.push({ id, description: "" });
    known.add(id);
    added.push(id);
  }
  file.categories.sort((a, b) => a.id.localeCompare(b.id));
  file.updatedAt = new Date().toISOString();
  const out = assertWritableCategoriesFile(vaultPath);
  writeJson(out, file);
  return { added, file };
}
