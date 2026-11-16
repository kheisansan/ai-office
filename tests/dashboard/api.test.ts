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

  it("serves wiki page by name and rejects traversal", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-wiki-"));
    const vaultPath = path.join(root, "vault");
    const dataDir = path.join(root, "data");
    fs.cpSync(path.join(REPO_ROOT, "fixtures/sample-vault"), vaultPath, {
      recursive: true,
    });
    const app = createDashboardApp(loadConfig({ vaultPath, dataDir, aiMode: "stub" }));

    const page = await request(app)
      .get(`/api/wiki/${encodeURIComponent("LLM Wiki")}`)
      .expect(200);
    expect(page.body.ok).toBe(true);
    expect(page.body.name).toBe("LLM Wiki");
    expect(page.body.relPath).toBe("Wiki/AI/LLM Wiki.md");
    expect(page.body.content).toContain("# LLM Wiki");

    await request(app).get(`/api/wiki/${encodeURIComponent("../.env")}`).expect(404);
    await request(app).get(`/api/wiki/${encodeURIComponent("missing-page")}`).expect(404);

    const sourcesDir = path.join(vaultPath, "Sources", "Videos");
    fs.mkdirSync(sourcesDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourcesDir, "YT-Hermes.md"),
      `---
tags: [source, video]
source_url: https://youtu.be/abc123
---

# YT-Hermes

## Sources
- https://youtu.be/abc123
`,
      "utf8",
    );
    const source = await request(app)
      .get(`/api/wiki/${encodeURIComponent("YT-Hermes")}`)
      .expect(200);
    expect(source.body.kind).toBe("source");
    expect(source.body.sourceUrl).toBe("https://youtu.be/abc123");
    expect(source.body.relPath).toBe("Sources/Videos/YT-Hermes.md");
  });

  it("updates vaultPath via Status API and rejects missing dirs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-vault-cfg-"));
    const vaultPath = path.join(root, "vault");
    const vault2 = path.join(root, "vault2");
    const dataDir = path.join(root, "data");
    fs.cpSync(path.join(REPO_ROOT, "fixtures/sample-vault"), vaultPath, {
      recursive: true,
    });
    fs.cpSync(path.join(REPO_ROOT, "fixtures/sample-vault"), vault2, {
      recursive: true,
    });
    const config = loadConfig({ vaultPath, dataDir, aiMode: "stub" });
    const app = createDashboardApp(config);

    await request(app)
      .post("/api/config/vault")
      .send({ vaultPath: path.join(root, "missing") })
      .expect(400);

    const ok = await request(app)
      .post("/api/config/vault")
      .send({ vaultPath: vault2 })
      .expect(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.vaultPath).toBe(path.resolve(vault2));
    expect(config.vaultPath).toBe(path.resolve(vault2));

    const cfg = await request(app).get("/api/config").expect(200);
    expect(cfg.body.vaultPath).toBe(path.resolve(vault2));
  });
});
