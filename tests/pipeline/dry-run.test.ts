import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/lib/config.js";
import { REPO_ROOT } from "../../src/lib/paths.js";
import { runIngestDryRun } from "../../src/runner/ingest.js";

describe("phase0 dry-run", () => {
  it("runs receive→apply on sample vault copy", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-"));
    const vaultPath = path.join(root, "vault");
    const dataDir = path.join(root, "data");
    fs.cpSync(path.join(REPO_ROOT, "fixtures/sample-vault"), vaultPath, {
      recursive: true,
    });

    const config = loadConfig({ vaultPath, dataDir, ingestBatchLimit: 1, aiMode: "stub" });
    const result = await runIngestDryRun(config, {
      jobId: "test-demo",
      autoApprove: true,
    });

    expect(result.checksOk).toBe(true);
    expect(result.state.stage).toBe("applied");
    expect(fs.existsSync(path.join(vaultPath, "Wiki", "AI", "AIオフィス.md"))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "done", "test-demo.json"))).toBe(true);
  });
});
