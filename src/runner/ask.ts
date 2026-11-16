import fs from "node:fs";
import path from "node:path";
import type { OfficeConfig } from "../lib/config.js";
import { assertVaultReady } from "../lib/config.js";
import {
  assertSafeChildDir,
  assertSafeJobId,
  assertSafeWriteTarget,
  ensureDir,
  readJson,
  readText,
  writeJson,
  writeText,
} from "../lib/fsutil.js";
import { notify } from "../lib/notify.js";
import { stubAnswer } from "../pipeline/stub-ai.js";
import { verifyCitations } from "../retrieval/citations.js";
import { findCandidates } from "../retrieval/search.js";
import type {
  AskState,
  CandidatesFile,
  CitationChecksFile,
} from "../retrieval/types.js";
import { buildAnswererPrompt, runClaudePrompt } from "./claude.js";
import { stageVaultContext } from "./context.js";

/** First answer + 1 retry (= 2 attempts max) */
export const MAX_ANSWER_ATTEMPTS = 2;

export type AskOptions = {
  question: string;
  askId?: string;
  aiMode?: "claude" | "stub";
  candidateLimit?: number;
  silent?: boolean;
  /** Skip appending QUERY to vault log.md */
  skipLogAppend?: boolean;
};

export type AskResult = {
  answerDir: string;
  state: AskState;
  checksOk: boolean;
  answerPath: string;
  candidates: CandidatesFile;
  checks: CitationChecksFile;
};

function nowIso(): string {
  return new Date().toISOString();
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function slugFromQuestion(question: string): string {
  // Job ids are ASCII-only (assertSafeJobId). Keep latin tokens; JP-only → "q".
  const base = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return assertSafeJobId(`ask-${base || "q"}-${stamp}`.slice(0, 64));
}

export function answerDirFor(config: OfficeConfig, id: string): string {
  return assertSafeChildDir(path.join(config.dataDir, "answers"), id);
}

function writeState(answerDir: string, state: AskState): void {
  writeJson(path.join(answerDir, "state.json"), state);
}

function writeCitationFeedback(
  answerDir: string,
  checks: CitationChecksFile,
  attempt: number,
): void {
  const failing = checks.checks.filter((c) => !c.ok);
  const body = [
    `# Citation feedback (attempt ${attempt})`,
    "",
    "回答を書き直す。出典は `candidates.json` のページだけ。各主張に [[ページ名]]。",
    "",
    ...failing.map((c) => `- ${c.id}: ${c.message}`),
    "",
  ].join("\n");
  writeText(path.join(answerDir, "citation-feedback.md"), body);
}

function ensureAskDrafts(
  answerDir: string,
  question: string,
  candidateIds: string[],
  checksOk: boolean,
): void {
  const draft = path.join(answerDir, "draft");
  ensureDir(draft);

  const logPatch = path.join(draft, "log.patch");
  if (!fs.existsSync(logPatch)) {
    const refs =
      candidateIds.length > 0
        ? candidateIds.map((id) => `[[${id}]]`).join(", ")
        : "(no candidates)";
    writeText(
      logPatch,
      `- [QUERY] ${todayYmd()}: ${question.slice(0, 120)} → ${checksOk ? "answered" : "needs_human"} (${refs})\n`,
    );
  }

  const suggestions = path.join(draft, "ingest-suggestions.md");
  if (!fs.existsSync(suggestions)) {
    writeText(
      suggestions,
      [
        "# 取り込み候補",
        "",
        `- 質問: ${question}`,
        `- 日付: ${todayYmd()}`,
        "- （answerer が不足を書いた場合はここを更新）",
        "",
      ].join("\n"),
    );
  }

  const proposal = path.join(draft, "append-proposal.md");
  if (!fs.existsSync(proposal)) {
    writeText(
      proposal,
      [
        "# 追記提案（未承認・Vault 未反映）",
        "",
        "回答で足りない点を既存 Wiki に追記する案。人が確認してから反映する。",
        "",
        `- 質問: ${question}`,
        `- 日付: ${todayYmd()}`,
        "",
        "## 提案",
        "",
        "- （該当なし / answerer が埋める）",
        "",
      ].join("\n"),
    );
  }
}

/** Program-only: append QUERY line to vault log.md from draft/log.patch (once). */
export function appendQueryLog(answerDir: string, vaultPath: string): void {
  const marker = path.join(answerDir, "draft", "log.appended");
  if (fs.existsSync(marker)) return;
  const patchFile = path.join(answerDir, "draft", "log.patch");
  if (!fs.existsSync(patchFile)) return;
  const vaultFile = path.join(vaultPath, "log.md");
  assertSafeWriteTarget(vaultFile, [vaultPath]);
  ensureDir(path.dirname(vaultFile));
  const patch = readText(patchFile);
  if (fs.existsSync(vaultFile)) {
    fs.appendFileSync(vaultFile, patch.startsWith("\n") ? patch : `\n${patch}`);
  } else {
    writeText(vaultFile, `# Log\n\n${patch}`);
  }
  writeText(marker, `${new Date().toISOString()}\n`);
}

async function runAnswer(
  config: OfficeConfig,
  answerDir: string,
  question: string,
  candidates: CandidatesFile,
  mode: "claude" | "stub",
  attempt: number,
): Promise<void> {
  const ids = candidates.candidates.map((c) => c.id);
  stageVaultContext(answerDir, config.vaultPath, ids);

  const answerPath = path.join(answerDir, "answer.md");
  if (fs.existsSync(answerPath)) fs.unlinkSync(answerPath);

  if (mode === "stub") {
    stubAnswer(answerDir, question, ids, { attempt });
    return;
  }

  const feedbackPath = path.join(answerDir, "citation-feedback.md");
  const feedback = fs.existsSync(feedbackPath)
    ? fs.readFileSync(feedbackPath, "utf8")
    : "";
  const prompt = [
    buildAnswererPrompt(answerDir),
    feedback ? `\n## 前回の出典検証フィードバック\n${feedback}` : "",
    `\n(answer attempt ${attempt}/${MAX_ANSWER_ATTEMPTS})`,
  ].join("\n");
  const result = await runClaudePrompt({
    claudePath: config.claudePath,
    prompt,
    jobDir: answerDir,
    step: `answer-${attempt}`,
  });
  if (!result.ok) {
    throw new Error(`Answerer (claude -p) failed: ${result.stderr || result.stdout}`);
  }
  if (!fs.existsSync(answerPath) || fs.statSync(answerPath).size === 0) {
    throw new Error("Answerer finished but answer.md is missing/empty");
  }
}

/**
 * Ask the Wiki: candidates → answer → citation verify (1 retry) → QUERY log.
 */
export async function runAsk(
  config: OfficeConfig,
  options: AskOptions,
): Promise<AskResult> {
  assertVaultReady(config);
  const question = options.question.trim();
  if (!question) throw new Error("question is empty");

  const id = assertSafeJobId(options.askId ?? slugFromQuestion(question));
  const answerDir = answerDirFor(config, id);
  ensureDir(answerDir);
  const aiMode = options.aiMode ?? config.aiMode;

  writeJson(path.join(answerDir, "question.json"), {
    id,
    question,
    createdAt: nowIso(),
  });

  let state: AskState = {
    id,
    stage: "received",
    question,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  writeState(answerDir, state);

  const candidates = findCandidates(
    config.vaultPath,
    question,
    options.candidateLimit ?? 8,
  );
  writeJson(path.join(answerDir, "candidates.json"), candidates);
  state = { ...state, stage: "candidates", updatedAt: nowIso() };
  writeState(answerDir, state);

  let checks: CitationChecksFile = {
    ok: false,
    checks: [],
    verifiedAt: nowIso(),
  };

  try {
    for (let attempt = 1; attempt <= MAX_ANSWER_ATTEMPTS; attempt++) {
      state = {
        ...state,
        stage: "answered",
        answerAttempts: attempt,
        updatedAt: nowIso(),
      };
      writeState(answerDir, state);

      await runAnswer(config, answerDir, question, candidates, aiMode, attempt);

      const answerMd = readText(path.join(answerDir, "answer.md"));
      checks = verifyCitations(answerMd, candidates.candidates);
      writeJson(path.join(answerDir, "checks.json"), checks);

      if (checks.ok) {
        state = {
          ...state,
          stage: "verified",
          lastCheckErrors: [],
          updatedAt: nowIso(),
        };
        writeState(answerDir, state);
        break;
      }

      const errors = checks.checks.filter((c) => !c.ok).map((c) => c.message);
      state = {
        ...state,
        lastCheckErrors: errors,
        updatedAt: nowIso(),
      };
      writeState(answerDir, state);
      writeCitationFeedback(answerDir, checks, attempt);

      if (attempt >= MAX_ANSWER_ATTEMPTS) break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state = {
      ...state,
      stage: "needs_human",
      lastCheckErrors: [message],
      updatedAt: nowIso(),
    };
    writeState(answerDir, state);
    checks = {
      ok: false,
      checks: [{ id: "answerer-error", ok: false, message }],
      verifiedAt: nowIso(),
    };
    writeJson(path.join(answerDir, "checks.json"), checks);
  }

  const checksOk = checks.ok;
  ensureAskDrafts(
    answerDir,
    question,
    candidates.candidates.map((c) => c.id),
    checksOk,
  );

  if (checksOk) {
    if (!options.skipLogAppend) {
      appendQueryLog(answerDir, config.vaultPath);
    }
    state = { ...state, stage: "done", updatedAt: nowIso() };
  } else {
    state = { ...state, stage: "needs_human", updatedAt: nowIso() };
  }
  writeState(answerDir, state);

  if (!options.silent) {
    if (state.stage === "done") {
      notify("AI Office", `回答完了: ${state.id}`);
    } else {
      notify("AI Office", `回答要確認: ${state.id}`);
    }
  }

  return {
    answerDir,
    state,
    checksOk,
    answerPath: path.join(answerDir, "answer.md"),
    candidates,
    checks,
  };
}

export function readAskState(config: OfficeConfig, askId: string): AskState {
  const id = assertSafeJobId(askId);
  return readJson<AskState>(path.join(answerDirFor(config, id), "state.json"));
}

export function readAskAnswer(config: OfficeConfig, askId: string): string {
  const id = assertSafeJobId(askId);
  const p = path.join(answerDirFor(config, id), "answer.md");
  if (!fs.existsSync(p)) throw new Error(`No answer.md for ${id}`);
  return readText(p);
}
