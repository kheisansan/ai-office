import fs from "node:fs";
import path from "node:path";
import { pathHasOpenClaw } from "../lib/fsutil.js";
import type { WikiPageDoc } from "./types.js";

function parseSimpleFrontmatter(text: string): {
  fm: Record<string, unknown>;
  body: string;
} {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: text };
  const fm: Record<string, unknown> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let raw = line.slice(idx + 1).trim();
    if (!key) continue;
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1);
    }
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const inner = raw.slice(1, -1).trim();
      if (!inner) {
        fm[key] = [];
        continue;
      }
      fm[key] = inner.split(",").map((part) => {
        let p = part.trim();
        p = p.replace(/^["']|["']$/g, "");
        p = p.replace(/^\[\[|\]\]$/g, "");
        return p;
      });
      continue;
    }
    fm[key] = raw;
  }
  return { fm, body: m[2] ?? "" };
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string | number => typeof v === "string" || typeof v === "number").map(String);
  }
  if (typeof value === "string" && value) return [value];
  return [];
}

function firstHttpUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s)\]>"']+/i);
  return m?.[0]?.replace(/[.,;:]+$/, "");
}

/** Prefer frontmatter source_url, then ## Sources section, then any URL in body. */
export function extractSourceUrl(
  fm: Record<string, unknown>,
  body: string,
): string | undefined {
  for (const key of ["source_url", "sourceUrl", "url", "webpage_url"]) {
    const v = fm[key];
    if (typeof v === "string" && /^https?:\/\//i.test(v.trim())) {
      return v.trim();
    }
  }
  const sourcesSection =
    body.split(/^##\s*Sources\s*$/m)[1]?.split(/^##\s+/m)[0] ?? "";
  return firstHttpUrl(sourcesSection) ?? firstHttpUrl(body);
}

function walkMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (pathHasOpenClaw(full)) continue;
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** Index Wiki (+ optional Sources) pages for retrieval. */
export function scanVaultPages(
  vaultPath: string,
  options: { includeSources?: boolean } = {},
): WikiPageDoc[] {
  const roots = [path.join(vaultPath, "Wiki")];
  if (options.includeSources !== false) {
    roots.push(path.join(vaultPath, "Sources"));
  }
  const docs: WikiPageDoc[] = [];
  for (const root of roots) {
    for (const file of walkMarkdown(root)) {
      const text = fs.readFileSync(file, "utf8");
      const { fm, body } = parseSimpleFrontmatter(text);
      const id = path.basename(file, ".md");
      const titleMatch = body.match(/^#\s+(.+)$/m);
      const title = String(fm.title ?? titleMatch?.[1] ?? id);
      const relPath = path.relative(vaultPath, file).replace(/\\/g, "/");
      const kind: WikiPageDoc["kind"] = relPath.startsWith("Sources/")
        ? "source"
        : "wiki";
      const sourceUrl = extractSourceUrl(fm, body);
      docs.push({
        id,
        path: file,
        relPath,
        title,
        aliases: asStringArray(fm.aliases),
        tags: asStringArray(fm.tags),
        body,
        updated: typeof fm.updated === "string" ? fm.updated : undefined,
        kind,
        sourceUrl,
      });
    }
  }
  return docs;
}
