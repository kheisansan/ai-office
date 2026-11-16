import fs from "node:fs";
import path from "node:path";
import { Router, type Response } from "express";
import type { OfficeConfig } from "../lib/config.js";
import { setVaultPath } from "../lib/config.js";
import { pickFolder } from "../lib/pick-folder.js";
import { assertSafeIngestUrl } from "../lib/safe-url.js";
import { readTextWithin } from "../lib/fsutil.js";
import {
  approveJob,
  enqueueJob,
  getJobDiff,
  processQueue,
  readJobState,
  rejectJob,
} from "../runner/ingest.js";
import { readAskAnswer, readAskState, runAsk } from "../runner/ask.js";
import {
  gapTopics,
  listAnswerJobs,
  listQueueJobs,
  officeSummary,
  readWikiPage,
  summarizeUsage,
  wikiStats,
} from "./aggregate.js";

export type DashboardOptions = {
  config: OfficeConfig;
};

function sendError(res: Response, err: unknown, code = 400): void {
  const message = err instanceof Error ? err.message : String(err);
  res.status(code).json({ ok: false, error: message });
}

export function createDashboardRouter(options: DashboardOptions): Router {
  const router = Router();
  const { config } = options;
  let browseInFlight = false;

  router.get("/office", (_req, res) => {
    res.json({ ok: true, ...officeSummary(config) });
  });

  router.get("/queue", (_req, res) => {
    const jobs = listQueueJobs(config);
    res.json({
      ok: true,
      jobs,
      stages: groupByStage(jobs),
    });
  });

  router.post("/queue/enqueue", async (req, res) => {
    try {
      const safe = await assertSafeIngestUrl(String(req.body?.url ?? ""));
      const state = enqueueJob(config, {
        url: safe.href,
        jobId: req.body?.jobId ? String(req.body.jobId) : undefined,
        note: req.body?.note ? String(req.body.note) : undefined,
      });
      res.json({ ok: true, id: state.id, stage: state.stage });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/queue/run", async (req, res) => {
    try {
      const stub = Boolean(req.body?.stub ?? req.query.stub);
      const limit = req.body?.limit != null ? Number(req.body.limit) : undefined;
      const result = await processQueue(config, {
        limit: Number.isFinite(limit) ? limit : undefined,
        aiMode: stub ? "stub" : undefined,
        fixture: Boolean(req.body?.fixture),
        silent: true,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      sendError(res, err, 500);
    }
  });

  router.get("/jobs/:id", (req, res) => {
    try {
      const state = readJobState(config, req.params.id);
      const diff = getJobDiff(config, req.params.id);
      res.json({ ok: true, state, diff });
    } catch (err) {
      sendError(res, err, 404);
    }
  });

  router.post("/jobs/:id/approve", async (req, res) => {
    try {
      const comment = String(req.body?.comment ?? "approved via dashboard");
      const state = await approveJob(config, req.params.id, comment);
      res.json({ ok: true, stage: state.stage, id: state.id });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/jobs/:id/reject", async (req, res) => {
    try {
      const comment = String(req.body?.comment ?? "rejected via dashboard");
      const state = await rejectJob(config, req.params.id, comment);
      res.json({ ok: true, stage: state.stage, id: state.id });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/ask", (_req, res) => {
    res.json({ ok: true, answers: listAnswerJobs(config) });
  });

  router.get("/ask/:id", (req, res) => {
    try {
      const state = readAskState(config, req.params.id);
      const answer = readAskAnswer(config, req.params.id);
      const answerDir = path.join(config.dataDir, "answers", req.params.id);
      const suggestionsPath = path.join(answerDir, "draft", "ingest-suggestions.md");
      const proposalPath = path.join(answerDir, "draft", "append-proposal.md");
      res.json({
        ok: true,
        state,
        answer,
        ingestSuggestions: fs.existsSync(suggestionsPath)
          ? readTextWithin(suggestionsPath, answerDir)
          : "",
        appendProposal: fs.existsSync(proposalPath)
          ? readTextWithin(proposalPath, answerDir)
          : "",
      });
    } catch (err) {
      sendError(res, err, 404);
    }
  });

  router.post("/ask", async (req, res) => {
    try {
      const question = String(req.body?.question ?? "").trim();
      if (!question) {
        res.status(400).json({ ok: false, error: "question required" });
        return;
      }
      const stub = Boolean(req.body?.stub);
      const result = await runAsk(config, {
        question,
        askId: req.body?.askId ? String(req.body.askId) : undefined,
        aiMode: stub ? "stub" : undefined,
        silent: true,
      });
      const answerDir = path.dirname(result.answerPath);
      const answer = fs.existsSync(result.answerPath)
        ? readTextWithin(result.answerPath, answerDir)
        : "";
      res.json({
        ok: result.checksOk,
        id: result.state.id,
        stage: result.state.stage,
        answer,
        candidateCount: result.candidates.candidates.length,
      });
    } catch (err) {
      sendError(res, err, 500);
    }
  });

  router.get("/knowledge", (_req, res) => {
    res.json({
      ok: true,
      wiki: wikiStats(config.vaultPath),
      gaps: gapTopics(config),
    });
  });

  router.get("/wiki/:name", (req, res) => {
    const name = decodeURIComponent(String(req.params.name ?? "")).trim();
    if (!name) {
      res.status(400).json({ ok: false, error: "name required" });
      return;
    }
    const page = readWikiPage(config.vaultPath, name);
    if (!page) {
      res.status(404).json({ ok: false, error: `wiki page not found: ${name}` });
      return;
    }
    res.json({ ok: true, ...page });
  });

  router.get("/usage", (_req, res) => {
    res.json({ ok: true, ...summarizeUsage(config) });
  });

  router.get("/config", (_req, res) => {
    res.json({
      ok: true,
      vaultPath: config.vaultPath,
      dataDir: config.dataDir,
      aiMode: config.aiMode,
      ingestBatchLimit: config.ingestBatchLimit,
      weeklyIngestTokenBudget: config.weeklyIngestTokenBudget,
      weeklyAskTokenBudget: config.weeklyAskTokenBudget,
      note: "vaultPath can be updated from Status; dataDir remains env/settings only.",
    });
  });

  router.post("/config/vault", (req, res) => {
    try {
      const vaultPath = String(req.body?.vaultPath ?? "").trim();
      const result = setVaultPath(config, vaultPath);
      res.json({ ok: true, ...result });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/config/vault/browse", async (_req, res) => {
    if (browseInFlight) {
      res.status(409).json({ ok: false, error: "folder picker already open" });
      return;
    }
    browseInFlight = true;
    try {
      const selected = await pickFolder({ defaultPath: config.vaultPath });
      if (!selected) {
        res.json({ ok: true, cancelled: true });
        return;
      }
      res.json({ ok: true, cancelled: false, vaultPath: selected });
    } catch (err) {
      sendError(res, err, 500);
    } finally {
      browseInFlight = false;
    }
  });

  return router;
}

function groupByStage(
  jobs: Array<{ id: string; stage: string }>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const j of jobs) {
    out[j.stage] ??= [];
    out[j.stage].push(j.id);
  }
  return out;
}

