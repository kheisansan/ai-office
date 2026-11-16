import fs from "node:fs";
import path from "node:path";
import type { OfficeConfig } from "../lib/config.js";
import { readJson, readText, writeJson } from "../lib/fsutil.js";
import { listWikiCategories } from "../lib/wiki-layout.js";
import type { JobState } from "../pipeline/types.js";
import type { AskState } from "../retrieval/types.js";

export type QueueJobSummary = {
  id: string;
  stage: string;
  url?: string;
  question?: string;
  updatedAt: string;
  integrateAttempts?: number;
  answerAttempts?: number;
};

export type UsageEvent = {
  kind: "ingest" | "ask";
  jobId: string;
  step: string;
  at: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type UsageSummary = {
  events: UsageEvent[];
  byDay: Record<string, { ingest: number; ask: number }>;
  weekIngest: number;
  weekAsk: number;
  weeklyIngestTokenBudget: number;
  weeklyAskTokenBudget: number;
};

export type WikiStats = {
  pageCount: number;
  byCategory: Array<{ name: string; pageCount: number }>;
  brokenLinks: Array<{ page: string; target: string }>;
  orphanCandidates: string[];
};

export type GapTopic = {
  askId: string;
  question: string;
  updatedAt: string;
  snippet: string;
};

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

/** If a job died mid-integrate, promote or mark needs_human using checks.json. */
export function healQueueJobStage(jobDir: string, state: JobState): JobState {
  const transient = new Set([
    "received",
    "fetched",
    "prepared",
    "summarized",
    "integrated",
    "verified",
  ]);
  if (!transient.has(state.stage)) return state;

  const checksPath = path.join(jobDir, "checks.json");
  if (fs.existsSync(checksPath)) {
    try {
      const checks = readJson<{ ok?: boolean }>(checksPath);
      const next: JobState = {
        ...state,
        stage: checks.ok ? "awaiting_approval" : "needs_human",
        updatedAt: new Date().toISOString(),
      };
      writeJson(path.join(jobDir, "state.json"), next);
      return next;
    } catch {
      /* fall through */
    }
  }

  // No checks yet and still mid-flight — leave as-is (may be actively running)
  return state;
}

export function listQueueJobs(config: OfficeConfig): QueueJobSummary[] {
  const queueDir = path.join(config.dataDir, "queue");
  if (!fs.existsSync(queueDir)) return [];
  return fs
    .readdirSync(queueDir)
    .filter((name) => fs.existsSync(path.join(queueDir, name, "state.json")))
    .map((name) => {
      const jobDir = path.join(queueDir, name);
      let state = readJson<JobState>(path.join(jobDir, "state.json"));
      state = healQueueJobStage(jobDir, state);
      return {
        id: state.id,
        stage: state.stage,
        url: state.request?.url,
        updatedAt: state.updatedAt,
        integrateAttempts: state.integrateAttempts,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listAnswerJobs(config: OfficeConfig): QueueJobSummary[] {
  const answersDir = path.join(config.dataDir, "answers");
  if (!fs.existsSync(answersDir)) return [];
  return fs
    .readdirSync(answersDir)
    .filter((name) => fs.existsSync(path.join(answersDir, name, "state.json")))
    .map((name) => {
      const state = readJson<AskState>(path.join(answersDir, name, "state.json"));
      return {
        id: state.id,
        stage: state.stage,
        question: state.question,
        updatedAt: state.updatedAt,
        answerAttempts: state.answerAttempts,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function officeSummary(config: OfficeConfig): {
  vaultPath: string;
  dataDir: string;
  aiMode: string;
  awaitingApproval: number;
  needsHuman: number;
  queued: number;
  recentAnswers: number;
  recentJobs: QueueJobSummary[];
  logTail: string[];
} {
  const jobs = listQueueJobs(config);
  const answers = listAnswerJobs(config);
  const logPath = path.join(config.vaultPath, "log.md");
  const logTail = fs.existsSync(logPath)
    ? readText(logPath).trim().split("\n").filter(Boolean).slice(-12)
    : [];
  return {
    vaultPath: config.vaultPath,
    dataDir: config.dataDir,
    aiMode: config.aiMode,
    awaitingApproval: jobs.filter((j) => j.stage === "awaiting_approval").length,
    needsHuman: jobs.filter((j) => j.stage === "needs_human").length,
    queued: jobs.filter((j) => j.stage === "queued" || j.stage === "received").length,
    recentAnswers: answers.length,
    recentJobs: [...jobs, ...answers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12),
    logTail,
  };
}

function parseUsageFile(
  file: string,
  kind: "ingest" | "ask",
  jobId: string,
): UsageEvent | null {
  try {
    const raw = readJson<{
      step?: string;
      at?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    }>(file);
    const input = Number(raw.usage?.input_tokens ?? 0);
    const output = Number(raw.usage?.output_tokens ?? 0);
    return {
      kind,
      jobId,
      step: raw.step ?? path.basename(file, ".json"),
      at: raw.at ?? fs.statSync(file).mtime.toISOString(),
      inputTokens: input,
      outputTokens: output,
      totalTokens: input + output,
    };
  } catch {
    return null;
  }
}

function collectUsageFromRoot(
  root: string,
  kind: "ingest" | "ask",
): UsageEvent[] {
  if (!fs.existsSync(root)) return [];
  const events: UsageEvent[] = [];
  for (const jobId of fs.readdirSync(root)) {
    const usageDir = path.join(root, jobId, "usage");
    if (!fs.existsSync(usageDir)) continue;
    for (const file of fs.readdirSync(usageDir)) {
      if (!file.endsWith(".json")) continue;
      const ev = parseUsageFile(path.join(usageDir, file), kind, jobId);
      if (ev) events.push(ev);
    }
  }
  return events;
}

function startOfWeekIso(d = new Date()): string {
  const day = d.getUTCDay() || 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (day - 1));
  return monday.toISOString().slice(0, 10);
}

export function summarizeUsage(config: OfficeConfig): UsageSummary {
  const events = [
    ...collectUsageFromRoot(path.join(config.dataDir, "queue"), "ingest"),
    ...collectUsageFromRoot(path.join(config.dataDir, "answers"), "ask"),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const byDay: Record<string, { ingest: number; ask: number }> = {};
  const weekStart = startOfWeekIso();
  let weekIngest = 0;
  let weekAsk = 0;

  for (const ev of events) {
    const day = ev.at.slice(0, 10);
    byDay[day] ??= { ingest: 0, ask: 0 };
    byDay[day][ev.kind] += ev.totalTokens;
    if (day >= weekStart) {
      if (ev.kind === "ingest") weekIngest += ev.totalTokens;
      else weekAsk += ev.totalTokens;
    }
  }

  return {
    events,
    byDay,
    weekIngest,
    weekAsk,
    weeklyIngestTokenBudget: config.weeklyIngestTokenBudget,
    weeklyAskTokenBudget: config.weeklyAskTokenBudget,
  };
}

export type WikiPage = {
  name: string;
  relPath: string;
  content: string;
  kind: "wiki" | "source";
  sourceUrl?: string;
};

function extractPageSourceUrl(content: string): string | undefined {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    for (const key of ["source_url", "sourceUrl", "url", "webpage_url"]) {
      const line = fm[1].split("\n").find((l) => l.startsWith(`${key}:`));
      if (!line) continue;
      const v = line.slice(key.length + 1).trim();
      if (/^https?:\/\//i.test(v)) return v;
    }
  }
  const sources =
    content.split(/^##\s*Sources\s*$/m)[1]?.split(/^##\s+/m)[0] ?? "";
  return sources.match(/https?:\/\/[^\s)\]>"']+/i)?.[0];
}

/** Resolve Wiki or Sources page by basename. Rejects path traversal. */
export function readWikiPage(vaultPath: string, pageName: string): WikiPage | null {
  const wanted = pageName.trim();
  if (!wanted || /[/\\]|\.\./.test(wanted)) return null;
  const roots: Array<{ dir: string; kind: "wiki" | "source"; prefix: string }> = [
    { dir: path.join(vaultPath, "Wiki"), kind: "wiki", prefix: "Wiki/" },
    { dir: path.join(vaultPath, "Sources"), kind: "source", prefix: "Sources/" },
  ];
  for (const root of roots) {
    const files = walkFiles(root.dir).filter((f) => f.endsWith(".md"));
    const match = files.find((f) => path.basename(f, ".md") === wanted);
    if (!match) continue;
    const relPath = path.relative(vaultPath, match).replace(/\\/g, "/");
    if (!relPath.startsWith(root.prefix) || relPath.includes("..")) continue;
    const content = fs.readFileSync(match, "utf8");
    return {
      name: wanted,
      relPath,
      content,
      kind: root.kind,
      sourceUrl: extractPageSourceUrl(content),
    };
  }
  return null;
}

export function wikiStats(vaultPath: string): WikiStats {
  const wikiRoot = path.join(vaultPath, "Wiki");
  const cats = listWikiCategories(vaultPath);
  const pages = walkFiles(wikiRoot).filter((f) => f.endsWith(".md"));
  const pageNames = new Set(pages.map((f) => path.basename(f, ".md")));
  const brokenLinks: Array<{ page: string; target: string }> = [];
  const inbound = new Map<string, number>();
  for (const name of pageNames) inbound.set(name, 0);

  const linkRe = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  for (const file of pages) {
    const text = fs.readFileSync(file, "utf8");
    const page = path.basename(file, ".md");
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(text)) !== null) {
      const target = m[1].trim();
      if (!pageNames.has(target)) {
        brokenLinks.push({ page, target });
      } else {
        inbound.set(target, (inbound.get(target) ?? 0) + 1);
      }
    }
  }

  const orphanCandidates = [...pageNames].filter((n) => (inbound.get(n) ?? 0) === 0);

  return {
    pageCount: pages.length,
    byCategory: cats.map((c) => ({ name: c.name, pageCount: c.pageCount })),
    brokenLinks: brokenLinks.slice(0, 50),
    orphanCandidates: orphanCandidates.slice(0, 50),
  };
}

export function gapTopics(config: OfficeConfig): GapTopic[] {
  const answersDir = path.join(config.dataDir, "answers");
  if (!fs.existsSync(answersDir)) return [];
  const out: GapTopic[] = [];
  for (const id of fs.readdirSync(answersDir)) {
    const answerPath = path.join(answersDir, id, "answer.md");
    const statePath = path.join(answersDir, id, "state.json");
    if (!fs.existsSync(answerPath) || !fs.existsSync(statePath)) continue;
    const answer = readText(answerPath);
    if (!/Wiki に情報がない|情報がない/.test(answer)) continue;
    const state = readJson<AskState>(statePath);
    const section = answer.split("## Wiki に情報がないこと")[1]?.split("## ")[0] ?? "";
    out.push({
      askId: id,
      question: state.question,
      updatedAt: state.updatedAt,
      snippet: section.trim().slice(0, 400),
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
