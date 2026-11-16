import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeText(filePath: string, text: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, "utf8");
}

export function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

export function pathHasOpenClaw(target: string): boolean {
  return target.split(path.sep).some((part) => part.toLowerCase() === "openclaw");
}

export function assertSafeWriteTarget(target: string, allowedRoots: string[]): void {
  if (pathHasOpenClaw(target)) {
    throw new Error(`Refusing path containing OpenClaw: ${target}`);
  }
  const resolved = path.resolve(target);
  const ok = allowedRoots.some((root) => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
  if (!ok) {
    throw new Error(`Refusing write outside allowed roots: ${resolved}`);
  }
}

const JOB_ID_RE = /^[a-zA-Z0-9._-]+$/;

/** Reject path traversal / odd job ids. */
export function assertSafeJobId(jobId: string): string {
  if (
    !JOB_ID_RE.test(jobId) ||
    jobId === "." ||
    jobId === ".." ||
    jobId.includes("..") ||
    path.basename(jobId) !== jobId
  ) {
    throw new Error(
      `Invalid job id "${jobId}". Use only letters, digits, ".", "_", "-" (no "." / ".." alone or path segments)`,
    );
  }
  return jobId;
}

/** Resolve a job/answer dir and ensure it stays under the expected parent. */
export function assertSafeChildDir(parentDir: string, id: string): string {
  const safeId = assertSafeJobId(id);
  const resolvedParent = path.resolve(parentDir);
  const child = path.resolve(resolvedParent, safeId);
  if (child !== resolvedParent && !child.startsWith(resolvedParent + path.sep)) {
    throw new Error(`Refusing path escape: ${child} not under ${resolvedParent}`);
  }
  return child;
}
