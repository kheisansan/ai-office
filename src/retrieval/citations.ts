import type { CandidateHit, CitationCheck, CitationChecksFile } from "./types.js";

const SECTION_HEADERS = [
  "## 答え",
  "## Wiki で一部しか分からないこと",
  "## Wiki に情報がないこと",
  "## 参照したページ",
];

function splitSections(answer: string): Record<string, string> {
  const lines = answer.split("\n");
  const sections: Record<string, string[]> = {};
  let current = "_preamble";
  sections[current] = [];
  for (const line of lines) {
    const header = SECTION_HEADERS.find((h) => line.trim() === h);
    if (header) {
      current = header;
      sections[current] = [];
      continue;
    }
    sections[current] ??= [];
    sections[current].push(line);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sections)) out[k] = v.join("\n");
  return out;
}

function extractWikilinks(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((m) =>
    m[1].trim(),
  );
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith("#"));
}

/** Verify answer.md citations against candidates and required shape. */
export function verifyCitations(
  answerMarkdown: string,
  candidates: CandidateHit[],
): CitationChecksFile {
  const checks: CitationCheck[] = [];
  const allowed = new Set(candidates.map((c) => c.id));
  const sections = splitSections(answerMarkdown);

  for (const required of ["## 答え", "## Wiki に情報がないこと", "## 参照したページ"]) {
    checks.push({
      id: `section:${required}`,
      ok: Object.prototype.hasOwnProperty.call(sections, required),
      message: Object.prototype.hasOwnProperty.call(sections, required)
        ? "present"
        : `missing ${required}`,
    });
  }

  const answerBody = sections["## 答え"];
  if (answerBody !== undefined) {
    const answerParas = paragraphs(answerBody);
    checks.push({
      id: "section:## 答え:nonempty",
      ok: answerParas.length > 0,
      message:
        answerParas.length > 0
          ? "答え has content"
          : "empty ## 答え (headers alone are not enough)",
    });
  }

  const claimSections = ["## 答え", "## Wiki で一部しか分からないこと"];
  for (const name of claimSections) {
    const body = sections[name];
    if (body === undefined) continue;
    const paras = paragraphs(body);
    if (paras.length === 0) {
      // empty 「一部」 is ok; empty 「答え」 already flagged above
      continue;
    }
    for (const [i, para] of paras.entries()) {
      // skip pure headings / list markers without claims
      if (/^[-*]\s*$/.test(para)) continue;
      const links = extractWikilinks(para);
      const needsCite =
        name === "## 答え" ||
        (name === "## Wiki で一部しか分からないこと" && para.length > 20);
      if (needsCite && links.length === 0 && !/情報がない|不明|わからない/.test(para)) {
        checks.push({
          id: `cite-missing:${name}:${i}`,
          ok: false,
          message: `paragraph lacks [[citation]]: ${para.slice(0, 80)}`,
        });
      }
      for (const link of links) {
        const ok = allowed.has(link);
        checks.push({
          id: `cite-allowed:${link}`,
          ok,
          message: ok
            ? `[[${link}]] in candidates`
            : `[[${link}]] not in candidates`,
        });
      }
    }
  }

  // External http(s) URLs used as grounding in claim sections are banned
  for (const name of claimSections) {
    const body = sections[name] ?? "";
    if (/https?:\/\//i.test(body)) {
      checks.push({
        id: `external-url:${name}`,
        ok: false,
        message: "external URL used in claim section",
      });
    }
  }

  // 参照したページ must only list candidates
  const refs = extractWikilinks(sections["## 参照したページ"] ?? "");
  for (const link of refs) {
    checks.push({
      id: `ref:${link}`,
      ok: allowed.has(link),
      message: allowed.has(link)
        ? "ok"
        : `referenced [[${link}]] not in candidates`,
    });
  }

  return {
    ok: checks.every((c) => c.ok),
    checks,
    verifiedAt: new Date().toISOString(),
  };
}
