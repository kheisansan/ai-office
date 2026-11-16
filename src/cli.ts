#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./lib/config.js";
import { REPO_ROOT } from "./lib/paths.js";
import {
  approveJob,
  deleteRejectedJob,
  enqueueJob,
  getJobDiff,
  listQueueStates,
  processQueue,
  readJobState,
  rejectJob,
  runIngest,
  runIngestDryRun,
} from "./runner/ingest.js";
import { readAskAnswer, readAskState, runAsk } from "./runner/ask.js";
import { startDashboardServer } from "./dashboard/server.js";

function printHelp(): void {
  console.log(`ai-office CLI

Usage:
  office config                         Show resolved vault / data paths
  office dry-run [--job-id <id>]        Fixture pipeline on demo vault (no AI tokens)
  office enqueue <URL> [options]        Queue a URL (no fetch/AI yet)
  office ingest [URL] [options]         Process one URL, or drain queue if no URL
  office diff <job-id>                  Show draft diff + checks
  office approve <job-id> [--comment…]  Apply approved draft to vault
  office reject <job-id> [--comment…]   Reject draft
  office delete-rejected <job-id>       Delete rejected job (allows re-ingest)
  office status [job-id]                Queue list or one job state
  office ask "<question>" [options]     Answer from Wiki (citation-checked)
  office answer <ask-id>                Show saved answer.md
  office serve [--port N]               Local dashboard (http://127.0.0.1:3847)
  office help

enqueue options:
  --job-id <id>       Job id (default: derived from URL)
  --note <text>       Memo

ingest options:
  --job-id <id>       Job id
  --note <text>       Memo
  --limit <n>         Max queued jobs to process when no URL (default: ingestBatchLimit)
  --stub-ai           Stub summarizer/integrator (no Claude tokens)
  --fixture           Built-in sample captions (skip yt-dlp)
  --manual-transcript Keep existing raw/transcript.txt
  --force             Refetch even if raw/ exists
  --auto-approve      Approve immediately after checks pass (careful)
  --silent            Skip macOS notifications

ask options:
  --ask-id <id>       Answer id (default: derived from question + timestamp)
  --limit <n>         Max candidate pages (default: 8)
  --stub-ai           Stub answerer (no Claude tokens)
  --silent            Skip macOS notifications
  --skip-log          Do not append [QUERY] to vault log.md

Config: env > config/settings.json > defaults
  VAULT_PATH, DATA_DIR, AI_MODE=claude|stub, INGEST_BATCH_LIMIT

Dev: Cursor Auto. Ops AI: Claude Code Pro (claude -p).
`);
}

function parseFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  return args[i + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Invalid --limit "${raw}" (need a positive integer)`);
  }
  return Math.floor(n);
}

function positionals(rest: string[], flagNames: string[]): string[] {
  return rest.filter((a, i) => {
    if (a.startsWith("--")) return false;
    const prev = rest[i - 1];
    if (prev && flagNames.includes(prev)) return false;
    return true;
  });
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const flagNames = ["--job-id", "--note", "--comment", "--limit", "--ask-id", "--port"];

  if (!cmd || cmd === "help" || cmd === "--help") {
    printHelp();
    return;
  }

  if (cmd === "config") {
    const config = loadConfig();
    console.log(
      JSON.stringify(
        {
          vaultPath: config.vaultPath,
          vaultExists: fs.existsSync(config.vaultPath),
          dataDir: config.dataDir,
          aiMode: config.aiMode,
          ytDlpPath: config.ytDlpPath,
          claudePath: config.claudePath,
          ingestBatchLimit: config.ingestBatchLimit,
          sources: config.sources,
          settingsExample: path.join(REPO_ROOT, "config/settings.example.json"),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === "dry-run") {
    const jobId = parseFlag(rest, "--job-id");
    const base = loadConfig();
    const demoVault = path.join(base.dataDir, "demo-vault");
    fs.rmSync(demoVault, { recursive: true, force: true });
    fs.cpSync(path.join(REPO_ROOT, "fixtures/sample-vault"), demoVault, {
      recursive: true,
    });
    const config = { ...base, vaultPath: demoVault, aiMode: "stub" as const };
    const result = await runIngestDryRun(config, {
      jobId: jobId ?? "phase0-demo",
      autoApprove: true,
      fixtureTitle: "AI Office Demo Video",
    });
    console.log(
      JSON.stringify(
        {
          ok: result.checksOk && result.state.stage === "applied",
          stage: result.state.stage,
          jobDir: result.jobDir,
          vaultPath: config.vaultPath,
        },
        null,
        2,
      ),
    );
    if (!(result.checksOk && result.state.stage === "applied")) process.exitCode = 1;
    return;
  }

  if (cmd === "enqueue") {
    const url = positionals(rest, flagNames)[0];
    if (!url) {
      console.error("Usage: office enqueue <URL> [--job-id id] [--note text]");
      process.exitCode = 1;
      return;
    }
    const state = enqueueJob(loadConfig(), {
      url,
      jobId: parseFlag(rest, "--job-id"),
      note: parseFlag(rest, "--note"),
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          stage: state.stage,
          id: state.id,
          url: state.request.url,
          next: "office ingest   # process queued jobs",
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === "ingest") {
    const targetUrl = positionals(rest, flagNames)[0];
    const config = loadConfig();
    const useFixture = hasFlag(rest, "--fixture");
    const stubAi = hasFlag(rest, "--stub-ai");
    const silent = hasFlag(rest, "--silent");
    const limit = parsePositiveInt(parseFlag(rest, "--limit"));

    if (!targetUrl) {
      const result = await processQueue(config, {
        limit,
        aiMode: stubAi ? "stub" : undefined,
        autoApprove: hasFlag(rest, "--auto-approve"),
        fixture: useFixture,
        silent,
      });
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      if (result.processed.some((p) => !p.ok)) process.exitCode = 1;
      return;
    }

    const result = await runIngest(config, {
      url: targetUrl,
      jobId: parseFlag(rest, "--job-id"),
      note: parseFlag(rest, "--note"),
      aiMode: stubAi ? "stub" : undefined,
      autoApprove: hasFlag(rest, "--auto-approve"),
      fixtureTitle: useFixture ? "Fixture Source" : undefined,
      fixtureTranscript: useFixture
        ? "00:00 AI office combines agents, files, and human approval.\n01:00 Roles should be narrow."
        : undefined,
      fixtureDescription: useFixture ? "fixture description" : undefined,
      manualTranscript: hasFlag(rest, "--manual-transcript"),
      force: hasFlag(rest, "--force"),
      silent,
    });
    console.log(
      JSON.stringify(
        {
          ok: result.checksOk,
          stage: result.state.stage,
          jobDir: result.jobDir,
          vaultPath: config.vaultPath,
          integrateAttempts: result.state.integrateAttempts,
          aiMode: stubAi ? "stub" : config.aiMode,
          next:
            result.state.stage === "awaiting_approval"
              ? `office diff ${result.state.id} && office approve ${result.state.id}`
              : result.state.stage === "applied"
                ? "applied"
                : "inspect jobDir / fix checks",
        },
        null,
        2,
      ),
    );
    if (result.state.stage === "awaiting_approval" && !silent) {
      console.log("\n--- diff preview (truncated) ---\n");
      console.log(result.diff.slice(0, 4000));
      if (result.diff.length > 4000) {
        console.log(`\n… (full diff: office diff ${result.state.id})`);
      }
    }
    if (!result.checksOk) process.exitCode = 1;
    return;
  }

  if (cmd === "diff") {
    const jobId = rest[0];
    if (!jobId) {
      console.error("Usage: office diff <job-id>");
      process.exitCode = 1;
      return;
    }
    console.log(getJobDiff(loadConfig(), jobId));
    return;
  }

  if (cmd === "approve") {
    const jobId = rest[0];
    if (!jobId) {
      console.error("Usage: office approve <job-id> [--comment text]");
      process.exitCode = 1;
      return;
    }
    const comment = parseFlag(rest, "--comment") ?? "approved";
    const state = await approveJob(loadConfig(), jobId, comment);
    console.log(JSON.stringify({ ok: true, stage: state.stage, id: state.id }, null, 2));
    return;
  }

  if (cmd === "reject") {
    const jobId = rest[0];
    if (!jobId) {
      console.error("Usage: office reject <job-id> [--comment text]");
      process.exitCode = 1;
      return;
    }
    const comment = parseFlag(rest, "--comment") ?? "rejected";
    const state = await rejectJob(loadConfig(), jobId, comment);
    console.log(JSON.stringify({ ok: true, stage: state.stage, id: state.id }, null, 2));
    return;
  }

  if (cmd === "delete-rejected") {
    const jobId = rest[0];
    if (!jobId) {
      console.error("Usage: office delete-rejected <job-id>");
      process.exitCode = 1;
      return;
    }
    const result = deleteRejectedJob(loadConfig(), jobId);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (cmd === "status") {
    const config = loadConfig();
    const jobId = rest[0];
    if (jobId) {
      console.log(JSON.stringify(readJobState(config, jobId), null, 2));
      return;
    }
    const rows = listQueueStates(config).map((s) => ({
      id: s.id,
      stage: s.stage,
      url: s.request.url,
      integrateAttempts: s.integrateAttempts,
      updatedAt: s.updatedAt,
    }));
    const queued = rows.filter((r) => r.stage === "queued" || r.stage === "received").length;
    const awaiting = rows.filter((r) => r.stage === "awaiting_approval").length;
    console.log(
      JSON.stringify(
        {
          vaultPath: config.vaultPath,
          dataDir: config.dataDir,
          ingestBatchLimit: config.ingestBatchLimit,
          summary: { total: rows.length, queued, awaiting },
          jobs: rows,
        },
        null,
        2,
      ),
    );
    return;
  }


  if (cmd === "ask") {
    const question = positionals(rest, flagNames).join(" ").trim();
    if (!question) {
      console.error('Usage: office ask "<question>" [--ask-id id] [--stub-ai] [--silent]');
      process.exitCode = 1;
      return;
    }
    const stubAi = hasFlag(rest, "--stub-ai");
    const silent = hasFlag(rest, "--silent");
    const result = await runAsk(loadConfig(), {
      question,
      askId: parseFlag(rest, "--ask-id"),
      aiMode: stubAi ? "stub" : undefined,
      candidateLimit: parsePositiveInt(parseFlag(rest, "--limit")),
      silent,
      skipLogAppend: hasFlag(rest, "--skip-log"),
    });
    const answerPreview = fs.existsSync(result.answerPath)
      ? fs.readFileSync(result.answerPath, "utf8").slice(0, 2000)
      : "";
    console.log(
      JSON.stringify(
        {
          ok: result.checksOk,
          stage: result.state.stage,
          id: result.state.id,
          answerDir: result.answerDir,
          candidateCount: result.candidates.candidates.length,
          answerAttempts: result.state.answerAttempts,
          aiMode: stubAi ? "stub" : loadConfig().aiMode,
          next:
            result.state.stage === "done"
              ? `office answer ${result.state.id}`
              : "inspect answerDir / citation checks",
        },
        null,
        2,
      ),
    );
    if (answerPreview) {
      console.log("\n--- answer.md (preview) ---\n");
      console.log(answerPreview);
    }
    if (!result.checksOk) process.exitCode = 1;
    return;
  }

  if (cmd === "answer") {
    const askId = rest[0];
    if (!askId) {
      console.error("Usage: office answer <ask-id>");
      process.exitCode = 1;
      return;
    }
    const config = loadConfig();
    const state = readAskState(config, askId);
    console.log(
      JSON.stringify(
        { id: state.id, stage: state.stage, question: state.question },
        null,
        2,
      ),
    );
    console.log("\n" + readAskAnswer(config, askId));
    return;
  }


  if (cmd === "serve") {
    const portRaw = parseFlag(rest, "--port");
    const port = portRaw ? Number(portRaw) : 3847;
    if (!Number.isFinite(port) || port < 1) {
      console.error("Invalid --port");
      process.exitCode = 1;
      return;
    }
    const config = loadConfig();
    const { url } = await startDashboardServer({ config, port });
    console.log(`AI Office dashboard: ${url}`);
    console.log(`vault: ${config.vaultPath}`);
    console.log(`data:  ${config.dataDir}`);
    console.log("Ctrl+C to stop.");
    await new Promise(() => {});
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
