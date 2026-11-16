import fs from "node:fs";
import path from "node:path";
import { readTextWithin, writeText } from "../lib/fsutil.js";

export type PrepareResult = {
  preparedPath: string;
  charCount: number;
};

/** Strip timestamps / duplicate lines and write prepared.md. Called from ingest.ts. */
export function prepareTranscript(jobDir: string): PrepareResult {
  const rawPath = path.join(jobDir, "raw", "transcript.txt");
  const lines = readTextWithin(rawPath, jobDir)
    .split("\n")
    .map((l) => l.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, "").trim())
    .filter(Boolean);

  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] === line) continue;
    deduped.push(line);
  }

  const descPath = path.join(jobDir, "raw", "description.txt");
  const description = fs.existsSync(descPath)
    ? readTextWithin(descPath, jobDir).trim()
    : "";

  const parts = [`# Prepared transcript`, ``, deduped.join("\n\n")];
  if (description) {
    parts.push("", "# Description / 概要欄", "", description);
  }
  const body = `${parts.join("\n")}\n`;
  const preparedPath = path.join(jobDir, "prepared.md");
  writeText(preparedPath, body);
  return { preparedPath, charCount: body.length };
}
