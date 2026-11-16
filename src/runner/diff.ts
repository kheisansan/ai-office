import fs from "node:fs";
import path from "node:path";

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

export function formatJobDiff(jobDir: string): string {
  const draft = path.join(jobDir, "draft");
  const lines: string[] = [`# Diff for ${path.basename(jobDir)}`, ""];

  for (const file of listFiles(draft)) {
    const rel = path.relative(jobDir, file);
    const text = fs.readFileSync(file, "utf8");
    lines.push(`## ${rel}`, "", "```markdown", text.trimEnd(), "```", "");
  }

  const checksPath = path.join(jobDir, "checks.json");
  if (fs.existsSync(checksPath)) {
    lines.push("## checks.json", "", "```json", fs.readFileSync(checksPath, "utf8").trimEnd(), "```", "");
  }

  const statePath = path.join(jobDir, "state.json");
  if (fs.existsSync(statePath)) {
    lines.push("## state.json", "", "```json", fs.readFileSync(statePath, "utf8").trimEnd(), "```", "");
  }

  return lines.join("\n");
}
