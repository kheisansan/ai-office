import fs from "node:fs";
import path from "node:path";
import { readTextWithin } from "../lib/fsutil.js";

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/** Called from dashboard/routes getJobDiff — never follow draft symlinks outside jobDir. */
export function formatJobDiff(jobDir: string): string {
  const draft = path.join(jobDir, "draft");
  const lines: string[] = [`# Diff for ${path.basename(jobDir)}`, ""];

  for (const file of listFiles(draft)) {
    const rel = path.relative(jobDir, file);
    let text: string;
    try {
      text = readTextWithin(file, draft);
    } catch {
      lines.push(`## ${rel}`, "", "(skipped: unsafe path / symlink)", "");
      continue;
    }
    lines.push(`## ${rel}`, "", "```markdown", text.trimEnd(), "```", "");
  }

  const checksPath = path.join(jobDir, "checks.json");
  if (fs.existsSync(checksPath) && !fs.lstatSync(checksPath).isSymbolicLink()) {
    lines.push(
      "## checks.json",
      "",
      "```json",
      readTextWithin(checksPath, jobDir).trimEnd(),
      "```",
      "",
    );
  }

  const statePath = path.join(jobDir, "state.json");
  if (fs.existsSync(statePath) && !fs.lstatSync(statePath).isSymbolicLink()) {
    lines.push(
      "## state.json",
      "",
      "```json",
      readTextWithin(statePath, jobDir).trimEnd(),
      "```",
      "",
    );
  }

  return lines.join("\n");
}
