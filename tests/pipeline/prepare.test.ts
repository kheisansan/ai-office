import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareTranscript } from "../../src/pipeline/prepare.js";

describe("prepareTranscript", () => {
  it("strips timestamps, dedupes, and appends description", () => {
    const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-"));
    fs.mkdirSync(path.join(jobDir, "raw"), { recursive: true });
    fs.writeFileSync(
      path.join(jobDir, "raw", "transcript.txt"),
      "00:00 Hello\nHello\n01:00 World\n",
      "utf8",
    );
    fs.writeFileSync(path.join(jobDir, "raw", "description.txt"), "desc line\n", "utf8");

    const result = prepareTranscript(jobDir);
    const text = fs.readFileSync(result.preparedPath, "utf8");
    expect(text).toContain("Hello");
    expect(text).toContain("World");
    expect(text).toContain("desc line");
    expect(text).not.toMatch(/\d{2}:\d{2}/);
    expect(result.charCount).toBeGreaterThan(0);
  });
});
