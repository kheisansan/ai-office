import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeJson } from "../lib/fsutil.js";
import { REPO_ROOT } from "../lib/paths.js";

export type ClaudeRunResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  raw?: unknown;
};

function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

function asUsageRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function extractUsage(parsed: Record<string, unknown>): ClaudeRunResult["usage"] {
  const direct = asUsageRecord(parsed.usage);
  const nested =
    parsed.result && typeof parsed.result === "object" && !Array.isArray(parsed.result)
      ? asUsageRecord((parsed.result as Record<string, unknown>).usage)
      : undefined;
  const usage = direct ?? nested;
  if (!usage) return undefined;
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens,
  };
}

/**
 * One Claude Code headless session (Pro login).
 * cwd = jobDir + --restricted so file tools cannot touch the real vault.
 */
export async function runClaudePrompt(options: {
  claudePath: string;
  prompt: string;
  jobDir: string;
  step: string;
}): Promise<ClaudeRunResult> {
  const args = [
    "-p",
    options.prompt,
    "--output-format",
    "json",
    "--restricted",
    "--permission-prompts",
    "none",
    "--allowedTools",
    "Read,Write,Edit,Glob,Grep",
  ];

  const result = await run(options.claudePath, args, options.jobDir);
  const usageDir = path.join(options.jobDir, "usage");
  ensureDir(usageDir);

  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    parsed = undefined;
  }

  const usage = parsed ? extractUsage(parsed) : undefined;
  writeJson(path.join(usageDir, `${options.step}.json`), {
    step: options.step,
    ok: result.code === 0,
    at: new Date().toISOString(),
    usage,
    cwd: options.jobDir,
    flags: ["--restricted", "--permission-prompts=none"],
    stderr: result.stderr.slice(0, 4000),
    stdoutPreview: result.stdout.slice(0, 2000),
  });

  return {
    ok: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    usage,
    raw: parsed,
  };
}

export function buildSummarizerPrompt(jobDir: string): string {
  const agent = fs.readFileSync(
    path.join(REPO_ROOT, "agents/summarizer/AGENT.md"),
    "utf8",
  );
  return [
    agent,
    "",
    "## 今回のジョブ",
    `cwd（ここ以外には書けない）: ${jobDir}`,
    "1. `prepared.md` と `raw/metadata.json` を読む。",
    "2. Source ノートを `draft/Sources/Videos/<slug>.md` に書く。",
    "3. 書いたパスだけ短く報告する。",
  ].join("\n");
}

export function buildIntegratorPrompt(jobDir: string): string {
  const agent = fs.readFileSync(
    path.join(REPO_ROOT, "agents/integrator/AGENT.md"),
    "utf8",
  );
  return [
    agent,
    "",
    "## 今回のジョブ",
    `cwd（ここ以外には書けない）: ${jobDir}`,
    "保管庫の実体は渡していない。代わりに `context/` のコピーだけを読んでよい。",
    "1. `context/wiki-layout.md` でカテゴリを確認する。",
    "2. `draft/Sources/` を読む。",
    "3. `context/index.md` と `context/Wiki/` があれば読む。",
    "4. `draft/Wiki/<Category>/<ページ>.md` を書く（既存カテゴリ優先、なければ新規フォルダ可。Wiki直下禁止。`_schema/wiki-categories.json` は触らない）。",
    "5. 書いたパスだけ短く報告する。",
  ].join("\n");
}

export function buildAnswererPrompt(answerDir: string): string {
  const agent = fs.readFileSync(
    path.join(REPO_ROOT, "agents/answerer/AGENT.md"),
    "utf8",
  );
  return [
    agent,
    "",
    "## 今回のジョブ",
    `cwd（ここ以外には書けない）: ${answerDir}`,
    "保管庫の実体は渡していない。`context/Wiki/` と `context/Sources/`（あれば）と `candidates.json` だけを読んでよい。",
    "1. `question.json` と `candidates.json` を読む。",
    "2. `context/` 内の候補ページ本文を読む（候補以外は根拠にしない）。",
    "3. `answer.md` を指定の見出し構成で書く（各主張に [[ページ名]]）。",
    "4. Sources / YouTube 候補は `candidates.json` の `sourceUrl` を「参照したページ」に `[[id]] — https://...` で必ず書く。",
    "5. 不足があれば `draft/ingest-suggestions.md` と `draft/append-proposal.md` を更新してよい。",
    "6. 書いたパスだけ短く報告する。Web検索しない。Vault を直接書き換えない。",
  ].join("\n");
}
