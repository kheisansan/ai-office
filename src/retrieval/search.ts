import fs from "node:fs";
import path from "node:path";
import { scanVaultPages } from "./scan.js";
import type { CandidateHit, CandidatesFile, WikiPageDoc } from "./types.js";

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function scoreDoc(doc: WikiPageDoc, tokens: string[], question: string): CandidateHit | null {
  let score = 0;
  const reasons: string[] = [];
  const qLower = question.toLowerCase();
  const idLower = doc.id.toLowerCase();
  const titleLower = doc.title.toLowerCase();
  const bodyLower = doc.body.toLowerCase();

  if (idLower === qLower || titleLower === qLower) {
    score += 100;
    reasons.push("exact-title");
  }
  // Japanese questions often lack spaces; match title/id as substring or shared prefix
  const qCompact = qLower.replace(/[\s？?！!。、・「」『』]/g, "");
  if (idLower.length >= 2 && qCompact.includes(idLower)) {
    score += 55;
    reasons.push("id-in-question");
  } else if (titleLower.length >= 2 && qCompact.includes(titleLower)) {
    score += 55;
    reasons.push("title-in-question");
  } else if (idLower.length >= 3) {
    for (let n = Math.min(idLower.length, 12); n >= 3; n--) {
      const prefix = idLower.slice(0, n);
      if (qCompact.includes(prefix)) {
        score += 10 + n;
        reasons.push(`id-prefix:${prefix}`);
        break;
      }
    }
  }
  for (const alias of doc.aliases) {
    const a = alias.toLowerCase();
    if (qLower.includes(a) || a.includes(qLower)) {
      score += 40;
      reasons.push(`alias:${alias}`);
    }
  }
  for (const tag of doc.tags) {
    const t = tag.toLowerCase();
    if (tokens.some((tok) => t.includes(tok) || tok.includes(t))) {
      score += 15;
      reasons.push(`tag:${tag}`);
    }
  }
  for (const tok of tokens) {
    if (idLower.includes(tok) || titleLower.includes(tok)) {
      score += 20;
      reasons.push(`title-token:${tok}`);
    } else if (bodyLower.includes(tok)) {
      score += 5;
      reasons.push(`body-token:${tok}`);
    }
  }

  if (score <= 0) return null;

  const excerpts: string[] = [];
  const lines = doc.body.split("\n");
  for (const tok of tokens) {
    const hit = lines.find((l) => l.toLowerCase().includes(tok));
    if (hit && excerpts.length < 3) excerpts.push(hit.trim().slice(0, 240));
  }
  if (excerpts.length === 0) {
    excerpts.push(lines.filter((l) => l.trim()).slice(0, 4).join(" ").slice(0, 400));
  }

  return {
    id: doc.id,
    path: doc.path,
    relPath: doc.relPath,
    title: doc.title,
    score,
    reasons: [...new Set(reasons)].slice(0, 8),
    excerpts,
    kind: doc.kind,
    sourceUrl: doc.sourceUrl,
  };
}

function boostFromIndex(vaultPath: string, tokens: string[], hits: Map<string, CandidateHit>): void {
  const indexPath = path.join(vaultPath, "index.md");
  if (!fs.existsSync(indexPath)) return;
  const text = fs.readFileSync(indexPath, "utf8");
  const linkRe = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]([^\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(text)) !== null) {
    const id = m[1].trim();
    const blurb = (m[2] ?? "").toLowerCase();
    const line = m[0].toLowerCase();
    let boost = 0;
    for (const tok of tokens) {
      if (line.includes(tok) || blurb.includes(tok)) boost += 10;
    }
    if (boost <= 0) continue;
    const existing = hits.get(id);
    if (existing) {
      existing.score += boost;
      existing.reasons.push("index");
    }
  }
}

export function findCandidates(
  vaultPath: string,
  question: string,
  limit = 8,
): CandidatesFile {
  const tokens = tokenize(question);
  const docs = scanVaultPages(vaultPath);
  const hits = new Map<string, CandidateHit>();
  for (const doc of docs) {
    // Answerer grounds on Wiki primarily; still allow Sources if they score high
    const hit = scoreDoc(doc, tokens, question);
    if (!hit) continue;
    // Prefer Wiki over Sources when scores tie later
    if (doc.relPath.startsWith("Wiki/")) hit.score += 3;
    const existing = hits.get(doc.id);
    if (existing) {
      const incomingIsWiki = doc.relPath.startsWith("Wiki/");
      const existingIsWiki = existing.relPath.startsWith("Wiki/");
      // Never let Sources overwrite a Wiki hit with the same basename
      if (existingIsWiki && !incomingIsWiki) {
        if (hit.score > existing.score) existing.score = hit.score;
        continue;
      }
      if (!existingIsWiki && incomingIsWiki) {
        hits.set(doc.id, hit);
        continue;
      }
      if (hit.score > existing.score) hits.set(doc.id, hit);
      continue;
    }
    hits.set(doc.id, hit);
  }
  boostFromIndex(vaultPath, tokens, hits);

  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 8;
  const ranked = [...hits.values()]
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, cap));

  return {
    question,
    generatedAt: new Date().toISOString(),
    candidates: ranked,
  };
}
