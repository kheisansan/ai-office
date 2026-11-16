import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createDashboardApp } from "../../src/dashboard/server.js";
import { loadConfig } from "../../src/lib/config.js";
import { REPO_ROOT } from "../../src/lib/paths.js";
import { runIngest } from "../../src/runner/ingest.js";

describe("dashboard api", () => {
  it("serves office summary and approves awaiting job from API", async () => {
    process.env.AI_OFFICE_NOTIFY = "0";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-api-"));
    const vaultPath = path.join(root, "vault");
    const dataDir = path.join(root, "data");
    fs.cpSync(path.join(REPO_ROOT, "fixtures/sample-vault"), vaultPath, {
      recursive: true,
    });
    const config = loadConfig({ vaultPath, dataDir, aiMode: "stub" });

    const ingest = await runIngest(config, {
      jobId: "dash-approve",
      url: "https://example.com/watch?v=dash",
      aiMode: "stub",
      fixtureTitle: "Dash Fixture",
      fixtureTranscript: "00:00 agents and files\n",
      silent: true,
    });
    expect(ingest.state.stage).toBe("awaiting_approval");

    const app = createDashboardApp(config);
    const office = await request(app).get("/api/office").expect(200);
    expect(office.body.awaitingApproval).toBeGreaterThanOrEqual(1);

    const usage = await request(app).get("/api/usage").expect(200);
    expect(usage.body).toHaveProperty("weekIngest");
    expect(usage.body).toHaveProperty("byDay");

    const approved = await request(app)
      .post("/api/jobs/dash-approve/approve")
      .send({ comment: "ok from test" })
      .expect(200);
    expect(approved.body.stage).toBe("applied");
    expect(
      fs.existsSync(path.join(vaultPath, "Wiki", "AI", "AIオフィス.md")),
    ).toBe(true);
  });

  it("serves static index", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-api-"));
    const vaultPath = path.join(root, "vault");
    const dataDir = path.join(root, "data");
    fs.cpSync(path.join(REPO_ROOT, "fixtures/sample-vault"), vaultPath, {
      recursive: true,
    });
    const app = createDashboardApp(loadConfig({ vaultPath, dataDir, aiMode: "stub" }));
    const res = await request(app).get("/").expect(200);
    expect(res.text).toContain("AI Office");
  });
});
