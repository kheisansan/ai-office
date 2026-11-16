import fs from "node:fs";
import path from "node:path";
import type { OfficeConfig } from "../lib/config.js";
import { assertVaultReady } from "../lib/config.js";
import { assertSafeChildDir, assertSafeJobId, ensureDir, readJson, writeJson } from "../lib/fsutil.js";
import { notify } from "../lib/notify.js";
import { applyDraft } from "../pipeline/apply.js";
import { fetchSource } from "../pipeline/fetch.js";
import { prepareTranscript } from "../pipeline/prepare.js";
import { stubIntegrate, stubSummarize } from "../pipeline/stub-ai.js";
import type {
  ApprovalFile,
  ChecksFile,
  IngestRequest,
  JobState,
} from "../pipeline/types.js";
import { verifyDraft } from "../pipeline/verify.js";
import {
  buildIntegratorPrompt,
  buildSummarizerPrompt,
  runClaudePrompt,
} from "./claude.js";
import { guessCandidatePages, stageVaultContext } from "./context.js";
import { formatJobDiff } from "./diff.js";

/** First integrate + up to 2 retries (= 3 attempts max) */
export const MAX_INTEGRATE_ATTEMPTS = 3;

export type IngestOptions = {
  jobId?: string;
  url: string;
  note?: string;
  autoApprove?: boolean;
  fixtureTranscript?: string;
  fixtureTitle?: string;
  fixtureDescription?: string;
  manualTranscript?: boolean;
  force?: boolean;
  aiMode?: "claude" | "stub";
  /** Skip macOS notification for this run */
  silent?: boolean;
};

export type EnqueueOptions = {
  jobId?: string;
  url: string;
  note?: string;
};

export type ProcessQueueOptions = {
  limit?: number;
  aiMode?: "claude" | "stub";
  autoApprove?: boolean;
  fixture?: boolean;
  silent?: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function writeState(jobDir: string, state: JobState): void {
  writeJson(path.join(jobDir, "state.json"), state);
}

export function jobDirFor(config: OfficeConfig, id: string): string {
  return assertSafeChildDir(path.join(config.dataDir, "queue"), id);
}

function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const v = u.searchParams.get("v");
    if (v) return `yt-${v}`;
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "item";
    return `job-${last}`.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64);
  } catch {
    return `job-${Date.now()}`;
  }
}

async function runSummarize(
  config: OfficeConfig,
  jobDir: string,
  mode: "claude" | "stub",
): Promise<void> {
  if (mode === "stub") {
    stubSummarize(jobDir);
    return;
  }
  const result = await runClaudePrompt({
    claudePath: config.claudePath,
    prompt: buildSummarizerPrompt(jobDir),
    jobDir,
    step: "summarize",
  });
  if (!result.ok) {
    throw new Error(`Summarizer (claude -p) failed: ${result.stderr || result.stdout}`);
  }
  const draftSources = path.join(jobDir, "draft", "Sources");
  if (!fs.existsSync(draftSources) || fs.readdirSync(draftSources).length === 0) {
    throw new Error("Summarizer finished but draft/Sources is empty");
  }
}

function writeVerifyFeedback(jobDir: string, checks: ChecksFile, attempt: number): void {
  const failing = checks.checks.filter((c) => !c.ok);
  const body = [
    `# Verify feedback (attempt ${attempt})`,
    "",
    "統合をやり直す。以下を修正して `draft/Wiki/` と patch を書き直すこと。",
    "",
    ...failing.map((c) => `- ${c.id}: ${c.message}`),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(jobDir, "verify-feedback.md"), body, "utf8");
}

async function runIntegrate(
  config: OfficeConfig,
  jobDir: string,
  mode: "claude" | "stub",
  attempt: number,
): Promise<void> {
  if (mode === "stub") {
    stubIntegrate(jobDir, { vaultPath: config.vaultPath, attempt });
    return;
  }
  const candidates = guessCandidatePages(jobDir);
  stageVaultContext(jobDir, config.vaultPath, candidates);
  const feedbackPath = path.join(jobDir, "verify-feedback.md");
  const feedback = fs.existsSync(feedbackPath)
    ? fs.readFileSync(feedbackPath, "utf8")
    : "";
  const prompt = [
    buildIntegratorPrompt(jobDir),
    feedback ? `\n## 前回の検証フィードバック\n${feedback}` : "",
    `\n(integrate attempt ${attempt}/${MAX_INTEGRATE_ATTEMPTS})`,
  ].join("\n");
  const result = await runClaudePrompt({
    claudePath: config.claudePath,
    prompt,
    jobDir,
    step: `integrate-${attempt}`,
  });
  if (!result.ok) {
    throw new Error(`Integrator (claude -p) failed: ${result.stderr || result.stdout}`);
  }
  const draftWiki = path.join(jobDir, "draft", "Wiki");
  if (!fs.existsSync(draftWiki) || fs.readdirSync(draftWiki).length === 0) {
    throw new Error("Integrator finished but draft/Wiki is empty");
  }
}

async function integrateUntilVerified(
  config: OfficeConfig,
  jobDir: string,
  state: JobState,
  aiMode: "claude" | "stub",
): Promise<{ state: JobState; checks: ChecksFile }> {
  let current = state;
  let checks: ChecksFile = { ok: false, checks: [], verifiedAt: nowIso() };

  for (let attempt = 1; attempt <= MAX_INTEGRATE_ATTEMPTS; attempt++) {
    current = {
      ...current,
      stage: "integrated",
      integrateAttempts: attempt,
      updatedAt: nowIso(),
    };
    writeState(jobDir, current);

    await runIntegrate(config, jobDir, aiMode, attempt);
    checks = verifyDraft(jobDir, config.vaultPath);

    if (checks.ok) {
      current = {
        ...current,
        stage: "awaiting_approval",
        lastVerifyErrors: [],
        updatedAt: nowIso(),
      };
      writeState(jobDir, current);
      return { state: current, checks };
    }

    const errors = checks.checks.filter((c) => !c.ok).map((c) => c.message);
    current = {
      ...current,
      lastVerifyErrors: errors,
      updatedAt: nowIso(),
    };
    writeState(jobDir, current);
    writeVerifyFeedback(jobDir, checks, attempt);

    if (attempt >= MAX_INTEGRATE_ATTEMPTS) break;
    // clear wiki drafts before retry so integrator rewrites
    const wikiDraft = path.join(jobDir, "draft", "Wiki");
    if (fs.existsSync(wikiDraft)) {
      fs.rmSync(wikiDraft, { recursive: true, force: true });
    }
  }

  current = {
    ...current,
    stage: "needs_human",
    updatedAt: nowIso(),
  };
  writeState(jobDir, current);
  return { state: current, checks };
}

/** Register URL into the queue without running AI/fetch. */
export function enqueueJob(
  config: OfficeConfig,
  options: EnqueueOptions,
): JobState {
  assertVaultReady(config);
  const id = assertSafeJobId(options.jobId ?? slugFromUrl(options.url));
  const jobDir = jobDirFor(config, id);
  if (fs.existsSync(path.join(jobDir, "state.json"))) {
    const existing = readJson<JobState>(path.join(jobDir, "state.json"));
    if (existing.stage !== "queued" && existing.stage !== "received") {
      throw new Error(
        `Job ${id} already exists (stage=${existing.stage}). Pick another --job-id or finish/reject it first.`,
      );
    }
    if (existing.request.url !== options.url) {
      throw new Error(
        `Job ${id} already queued for a different URL:\n  existing: ${existing.request.url}\n  new: ${options.url}\nUse another --job-id.`,
      );
    }
    return existing;
  }
  ensureDir(jobDir);
  const request: IngestRequest = {
    id,
    url: options.url,
    note: options.note,
    createdAt: nowIso(),
  };
  writeJson(path.join(jobDir, "request.json"), request);
  const state: JobState = {
    id,
    stage: "queued",
    request,
    updatedAt: nowIso(),
  };
  writeState(jobDir, state);
  return state;
}

export async function runIngest(
  config: OfficeConfig,
  options: IngestOptions,
): Promise<{ jobDir: string; state: JobState; checksOk: boolean; diff: string }> {
  assertVaultReady(config);
  const id = assertSafeJobId(options.jobId ?? slugFromUrl(options.url));
  const jobDir = jobDirFor(config, id);
  ensureDir(jobDir);
  const aiMode = options.aiMode ?? config.aiMode;

  let request: IngestRequest;
  const requestPath = path.join(jobDir, "request.json");
  if (fs.existsSync(requestPath) && !options.force) {
    request = readJson<IngestRequest>(requestPath);
    if (options.note && !request.note) {
      request = { ...request, note: options.note };
      writeJson(requestPath, request);
    }
  } else {
    request = {
      id,
      url: options.url,
      note: options.note,
      createdAt: nowIso(),
    };
    writeJson(requestPath, request);
  }

  let state: JobState = {
    id,
    stage: "received",
    request,
    updatedAt: nowIso(),
  };
  writeState(jobDir, state);

  const rawDir = path.join(jobDir, "raw");
  const existingTranscript = path.join(rawDir, "transcript.txt");
  const hasRaw =
    fs.existsSync(existingTranscript) && fs.statSync(existingTranscript).size > 0;
  if (
    hasRaw &&
    !options.force &&
    !options.manualTranscript &&
    options.fixtureTranscript === undefined &&
    options.fixtureTitle === undefined
  ) {
    throw new Error(
      `Job raw/ already has transcript.txt. Re-run with --force to refetch, or --manual-transcript to keep it.`,
    );
  }
  if (options.force && hasRaw && !options.manualTranscript) {
    fs.rmSync(rawDir, { recursive: true, force: true });
  }

  await fetchSource({
    jobDir,
    url: request.url,
    ytDlpPath: config.ytDlpPath,
    fixtureTranscript: options.fixtureTranscript,
    fixtureTitle: options.fixtureTitle,
    fixtureDescription: options.fixtureDescription,
    manualTranscript: options.manualTranscript,
  });
  state = { ...state, stage: "fetched", updatedAt: nowIso() };
  writeState(jobDir, state);

  prepareTranscript(jobDir);
  state = { ...state, stage: "prepared", updatedAt: nowIso() };
  writeState(jobDir, state);

  await runSummarize(config, jobDir, aiMode);
  state = { ...state, stage: "summarized", updatedAt: nowIso() };
  writeState(jobDir, state);

  const { state: afterIntegrate, checks } = await integrateUntilVerified(
    config,
    jobDir,
    state,
    aiMode,
  );
  state = afterIntegrate;

  const diff = formatJobDiff(jobDir);
  fs.writeFileSync(path.join(jobDir, "diff.md"), diff, "utf8");

  if (!options.silent) {
    if (state.stage === "awaiting_approval") {
      notify("AI Office", `承認待ち: ${state.id}`);
    } else if (state.stage === "needs_human") {
      notify("AI Office", `要確認: ${state.id}（検証不合格）`);
    }
  }

  if (!checks.ok) {
    return { jobDir, state, checksOk: false, diff };
  }

  if (options.autoApprove) {
    await approveJob(config, id, "auto-approve");
    state = readJson<JobState>(path.join(jobDir, "state.json"));
  }

  return { jobDir, state, checksOk: checks.ok, diff };
}

/** Process queued jobs oldest-first, up to limit (default config.ingestBatchLimit). */
export async function processQueue(
  config: OfficeConfig,
  options: ProcessQueueOptions = {},
): Promise<{
  processed: Array<{ id: string; stage: string; ok: boolean }>;
  skipped: number;
}> {
  assertVaultReady(config);
  const limit = options.limit ?? config.ingestBatchLimit;
  const pending = listQueueStates(config)
    .filter((s) => s.stage === "queued" || s.stage === "received")
    .sort((a, b) => a.request.createdAt.localeCompare(b.request.createdAt))
    .slice(0, Math.max(0, limit));

  const processed: Array<{ id: string; stage: string; ok: boolean }> = [];
  for (const job of pending) {
    try {
      const result = await runIngest(config, {
        jobId: job.id,
        url: job.request.url,
        note: job.request.note,
        aiMode: options.aiMode,
        autoApprove: options.autoApprove,
        silent: true,
        fixtureTitle: options.fixture ? `Fixture ${job.id}` : undefined,
        fixtureTranscript: options.fixture
          ? "00:00 queue batch agents and files\n01:00 human approval\n"
          : undefined,
        fixtureDescription: options.fixture ? "queue fixture" : undefined,
      });
      processed.push({
        id: result.state.id,
        stage: result.state.stage,
        ok: result.checksOk,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const jobDir = jobDirFor(config, job.id);
      const statePath = path.join(jobDir, "state.json");
      if (fs.existsSync(statePath)) {
        const failed = readJson<JobState>(statePath);
        writeState(jobDir, {
          ...failed,
          stage: "needs_human",
          lastVerifyErrors: [message],
          updatedAt: nowIso(),
        });
      }
      processed.push({ id: job.id, stage: "needs_human", ok: false });
    }
  }

  const awaiting = processed.filter((p) => p.stage === "awaiting_approval").length;
  const needsHuman = processed.filter((p) => p.stage === "needs_human").length;
  if (!options.silent) {
    notify(
      "AI Office",
      `キュー処理 ${processed.length}件完了 / 承認待ち ${awaiting} / 要確認 ${needsHuman}`,
    );
  }

  const allQueued = listQueueStates(config).filter(
    (s) => s.stage === "queued" || s.stage === "received",
  ).length;

  return { processed, skipped: allQueued };
}

export async function runIngestDryRun(
  config: OfficeConfig,
  options: {
    jobId?: string;
    url?: string;
    autoApprove?: boolean;
    fixtureTranscript?: string;
    fixtureTitle?: string;
  } = {},
): Promise<{ jobDir: string; state: JobState; checksOk: boolean }> {
  const result = await runIngest(
    { ...config, aiMode: "stub" },
    {
      jobId: options.jobId,
      url: options.url ?? "https://example.com/watch?v=demo",
      autoApprove: options.autoApprove !== false,
      fixtureTranscript: options.fixtureTranscript,
      fixtureTitle: options.fixtureTitle ?? "AI Office Demo Video",
      aiMode: "stub",
      note: "phase0 dry-run",
      silent: true,
    },
  );
  return { jobDir: result.jobDir, state: result.state, checksOk: result.checksOk };
}

export async function approveJob(
  config: OfficeConfig,
  jobId: string,
  comment = "approved",
): Promise<JobState> {
  const id = assertSafeJobId(jobId);
  const jobDir = jobDirFor(config, id);
  const statePath = path.join(jobDir, "state.json");
  if (!fs.existsSync(statePath)) {
    throw new Error(`Job not found: ${id}`);
  }
  const state = readJson<JobState>(statePath);
  if (state.stage === "applied") {
    throw new Error(`Job already applied: ${id}`);
  }
  if (state.stage !== "awaiting_approval") {
    throw new Error(`Job not awaiting approval (stage=${state.stage})`);
  }

  const approval: ApprovalFile = {
    decision: "approve",
    comment,
    decidedAt: nowIso(),
  };
  writeJson(path.join(jobDir, "approval.json"), approval);
  applyDraft(jobDir, config.vaultPath);

  const next: JobState = { ...state, stage: "applied", updatedAt: nowIso() };
  writeState(jobDir, next);

  const doneDir = path.join(config.dataDir, "done");
  ensureDir(doneDir);
  writeJson(path.join(doneDir, `${id}.json`), {
    id,
    appliedAt: nowIso(),
    jobDir,
  });
  notify("AI Office", `反映完了: ${id}`);
  return next;
}

export async function rejectJob(
  config: OfficeConfig,
  jobId: string,
  comment = "rejected",
): Promise<JobState> {
  const id = assertSafeJobId(jobId);
  const jobDir = jobDirFor(config, id);
  const state = readJson<JobState>(path.join(jobDir, "state.json"));
  const approval: ApprovalFile = {
    decision: "reject",
    comment,
    decidedAt: nowIso(),
  };
  writeJson(path.join(jobDir, "approval.json"), approval);
  const next: JobState = { ...state, stage: "rejected", updatedAt: nowIso() };
  writeState(jobDir, next);
  return next;
}

export function getJobDiff(config: OfficeConfig, jobId: string): string {
  const id = assertSafeJobId(jobId);
  const jobDir = jobDirFor(config, id);
  const diffPath = path.join(jobDir, "diff.md");
  if (fs.existsSync(diffPath)) return fs.readFileSync(diffPath, "utf8");
  return formatJobDiff(jobDir);
}

export function listQueue(config: OfficeConfig): string[] {
  return listQueueStates(config).map((s) => s.id);
}

export function listQueueStates(config: OfficeConfig): JobState[] {
  const queueDir = path.join(config.dataDir, "queue");
  if (!fs.existsSync(queueDir)) return [];
  return fs
    .readdirSync(queueDir)
    .filter((name) => fs.existsSync(path.join(queueDir, name, "state.json")))
    .map((name) => readJson<JobState>(path.join(queueDir, name, "state.json")));
}

export function readJobState(config: OfficeConfig, jobId: string): JobState {
  const id = assertSafeJobId(jobId);
  return readJson<JobState>(path.join(jobDirFor(config, id), "state.json"));
}
