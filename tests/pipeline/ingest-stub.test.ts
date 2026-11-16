import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/lib/config.js";
import { REPO_ROOT } from "../../src/lib/paths.js";
import {
  approveJob,
  getJobDiff,
  rejectJob,
  runIngest,
} from "../../src/runner/ingest.js";

describe("phase1 ingest (stub ai + fixture fetch)", () => {
  it("stops at awaiting_approval and supports approve", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-"));
    const vaultPath = path.join(root, "vault");
    const dataDir = path.join(root, "data");
    fs.cpSync(path.join(REPO_ROOT, "fixtures/sample-vault"), vaultPath, {
      recursive: true,
    });
    const config = loadConfig({ vaultPath, dataDir, aiMode: "stub" });

    const result = await runIngest(config, {
      jobId: "ingest-1",
      url: "https://example.com/watch?v=phase1",
      aiMode: "stub",
      fixtureTitle: "Phase1 Fixture",
      fixtureTranscript: "00:00 hello agents\n01:00 files and approval\n",
      autoApprove: false,
    });

    expect(result.checksOk).toBe(true);
    expect(result.state.stage).toBe("awaiting_approval");
    expect(getJobDiff(config, "ingest-1")).toContain("Phase1 Fixture");

    const applied = await approveJob(config, "ingest-1", "lgtm");
    expect(applied.stage).toBe("applied");
    expect(fs.existsSync(path.join(vaultPath, "Wiki", "AI", "AIオフィス.md"))).toBe(true);
  });

  it("reject does not apply", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-"));
    const vaultPath = path.join(root, "vault");
    const dataDir = path.join(root, "data");
    fs.cpSync(path.join(REPO_ROOT, "fixtures/sample-vault"), vaultPath, {
      recursive: true,
    });
    const config = loadConfig({ vaultPath, dataDir, aiMode: "stub" });
    await runIngest(config, {
      jobId: "ingest-reject",
      url: "https://example.com/x",
      aiMode: "stub",
      fixtureTitle: "Reject Me",
      fixtureTranscript: "00:00 nope\n",
    });
    const state = await rejectJob(config, "ingest-reject", "needs work");
    expect(state.stage).toBe("rejected");
    expect(fs.existsSync(path.join(vaultPath, "Wiki", "AI", "AIオフィス.md"))).toBe(false);
  });
});
