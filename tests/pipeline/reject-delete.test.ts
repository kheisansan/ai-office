import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/lib/config.js";
import { REPO_ROOT } from "../../src/lib/paths.js";
import {
  deleteRejectedJob,
  enqueueJob,
  rejectJob,
} from "../../src/runner/ingest.js";

function tempConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-rej-"));
  const vaultPath = path.join(root, "vault");
  const dataDir = path.join(root, "data");
  fs.cpSync(path.join(REPO_ROOT, "fixtures/sample-vault"), vaultPath, {
    recursive: true,
  });
  return loadConfig({ vaultPath, dataDir, aiMode: "stub" });
}

describe("deleteRejectedJob", () => {
  it("removes rejected job so the same id/url can be enqueued again", async () => {
    const config = tempConfig();
    const url = "https://example.com/watch?v=rej1";
    enqueueJob(config, { url, jobId: "rej-1" });
    const jobDir = path.join(config.dataDir, "queue", "rej-1");
    fs.writeFileSync(
      path.join(jobDir, "state.json"),
      JSON.stringify(
        {
          id: "rej-1",
          stage: "rejected",
          request: { id: "rej-1", url, createdAt: new Date().toISOString() },
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(() => enqueueJob(config, { url, jobId: "rej-1" })).toThrow(/already exists/);

    const deleted = deleteRejectedJob(config, "rej-1");
    expect(deleted).toEqual({ id: "rej-1", deleted: true });
    expect(fs.existsSync(jobDir)).toBe(false);

    const again = enqueueJob(config, { url, jobId: "rej-1" });
    expect(again.stage).toBe("queued");
    expect(again.id).toBe("rej-1");
  });

  it("refuses to delete non-rejected jobs", async () => {
    const config = tempConfig();
    enqueueJob(config, { url: "https://example.com/a", jobId: "keep-1" });
    expect(() => deleteRejectedJob(config, "keep-1")).toThrow(/Only rejected/);
    await rejectJob(config, "keep-1", "nope");
    expect(deleteRejectedJob(config, "keep-1").deleted).toBe(true);
  });
});
