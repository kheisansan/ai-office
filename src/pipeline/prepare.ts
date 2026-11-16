import fs from "node:fs";
import path from "node:path";
import { readText, writeText } from "../lib/fsutil.js";

export type PrepareResult = {
  preparedPath: string;
  charCount: number;
};

/** Strip timestamps / duplicate lines and write prepared.md */
export function prepareTranscript(jobDir: string): PrepareResult {
  const rawPath = path.join(jobDir, "raw", "transcript.txt");
  const lines = readText(rawPath)
    .split("\n")
    .map((l) => l.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, "").trim())
    .filter(Boolean);

  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] === line) continue;
    deduped.push(line);
  }

  const descPath = path.join(jobDir, "raw", "description.txt");
  const description = fs.existsSync(descPath) ? readText(descPath).trim() : "";

  const parts = [`# Prepared transcript`, ``, deduped.join("\n\n")];
  if (description) {
    parts.push("", "# Description / 概要欄", "", description);
  }
  const body = `${parts.join("\n")}\n`;
  const preparedPath = path.join(jobDir, "prepared.md");
  writeText(preparedPath, body);
  return { preparedPath, charCount: body.length };
}
