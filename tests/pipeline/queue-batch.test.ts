import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/lib/config.js";
import { REPO_ROOT } from "../../src/lib/paths.js";
import {
  enqueueJob,
  listQueueStates,
  processQueue,
  runIngest,
} from "../../src/runner/ingest.js";

function tempConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-q-"));
  const vaultPath = path.join(root, "vault");
  const dataDir = path.join(root, "data");
  fs.cpSync(path.join(REPO_ROOT, "fixtures/sample-vault"), vaultPath, {
    recursive: true,
  });
  return loadConfig({
    vaultPath,
    dataDir,
    aiMode: "stub",
    ingestBatchLimit: 2,
  });
}

describe("phase2 queue batch", () => {
  it("rejects enqueue when same id has different URL", () => {
    const config = tempConfig();
    enqueueJob(config, { url: "https://example.com/a", jobId: "same-id" });
    expect(() =>
      enqueueJob(config, { url: "https://example.com/b", jobId: "same-id" }),
    ).toThrow(/different URL/);
  });

  it("enqueues then processQueue drains up to limit", async () => {
    const config = tempConfig();
    process.env.AI_OFFICE_NOTIFY = "0";

    enqueueJob(config, { url: "https://example.com/a", jobId: "q-a" });
    enqueueJob(config, { url: "https://example.com/b", jobId: "q-b" });
    enqueueJob(config, { url: "https://example.com/c", jobId: "q-c" });

    const queued = listQueueStates(config).filter((s) => s.stage === "queued");
    expect(queued).toHaveLength(3);

    const result = await processQueue(config, {
      limit: 2,
      aiMode: "stub",
      fixture: true,
      silent: true,
    });

    expect(result.processed).toHaveLength(2);
    expect(result.processed.every((p) => p.ok)).toBe(true);
    expect(result.processed.every((p) => p.stage === "awaiting_approval")).toBe(
      true,
    );

    const stillQueued = listQueueStates(config).filter((s) => s.stage === "queued");
    expect(stillQueued.map((s) => s.id)).toEqual(["q-c"]);
  });

  it("retries integrate once when stub fails first verify", async () => {
    const config = tempConfig();
    process.env.AI_OFFICE_NOTIFY = "0";
    process.env.AI_OFFICE_STUB_FAIL_FIRST_INTEGRATE = "1";
    try {
      const result = await runIngest(config, {
        jobId: "retry-1",
        url: "https://example.com/retry",
        aiMode: "stub",
        fixtureTitle: "Retry Fixture",
        fixtureTranscript: "00:00 retry test\n",
        silent: true,
      });
      expect(result.checksOk).toBe(true);
      expect(result.state.stage).toBe("awaiting_approval");
      expect(result.state.integrateAttempts).toBe(2);
      expect(
        fs.existsSync(
          path.join(config.dataDir, "queue", "retry-1", "verify-feedback.md"),
        ),
      ).toBe(true);
    } finally {
      delete process.env.AI_OFFICE_STUB_FAIL_FIRST_INTEGRATE;
    }
  });
});
