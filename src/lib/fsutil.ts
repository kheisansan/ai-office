import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function assertNotLinkedDestination(filePath: string): void {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return;
  const lst = fs.lstatSync(abs);
  if (lst.isSymbolicLink()) {
    throw new Error(`Refusing write through symlink: ${abs}`);
  }
  if (lst.isFile() && lst.nlink > 1) {
    throw new Error(`Refusing write through hardlink: ${abs}`);
  }
}

export function writeJson(filePath: string, value: unknown): void {
  assertNotLinkedDestination(filePath);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeText(filePath: string, text: string): void {
  assertNotLinkedDestination(filePath);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, "utf8");
}

export function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

export function pathHasOpenClaw(target: string): boolean {
  return target.split(path.sep).some((part) => part.toLowerCase() === "openclaw");
}

/** Resolve through realpath of deepest existing ancestor (follows symlinks). */
export function realpathWithin(target: string): string {
  let cur = path.resolve(target);
  const missing: string[] = [];
  while (!fs.existsSync(cur)) {
    missing.unshift(path.basename(cur));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  try {
    cur = fs.realpathSync(cur);
  } catch {
    /* keep cur */
  }
  return missing.length > 0 ? path.join(cur, ...missing) : cur;
}

/** True if resolved path is inside root (after realpath). */
export function isPathInsideRoot(target: string, root: string): boolean {
  const resolved = realpathWithin(target);
  const r = realpathWithin(root);
  return resolved === r || resolved.startsWith(r + path.sep);
}

/** Refuse symlinks and hardlinks (nlink>1) used as draft/vault file sources. */
export function assertUnlinkedRegularFile(target: string): fs.Stats {
  const lst = fs.lstatSync(target);
  if (lst.isSymbolicLink()) {
    throw new Error(`Refusing symlink: ${target}`);
  }
  if (!lst.isFile()) {
    throw new Error(`Refusing non-file: ${target}`);
  }
  if (lst.nlink > 1) {
    throw new Error(`Refusing hardlink source: ${target}`);
  }
  return lst;
}

/**
 * Refuse symlinks/hardlinks and paths that escape root.
 * Returns the real path when safe.
 */
export function assertReadablePathWithin(target: string, root: string): string {
  if (pathHasOpenClaw(target)) {
    throw new Error(`Refusing path containing OpenClaw: ${target}`);
  }
  const resolvedTarget = path.resolve(target);
  if (!fs.existsSync(resolvedTarget)) {
    throw new Error(`Path not found: ${resolvedTarget}`);
  }
  assertUnlinkedRegularFile(resolvedTarget);
  const real = fs.realpathSync(resolvedTarget);
  if (pathHasOpenClaw(real)) {
    throw new Error(`Refusing path containing OpenClaw: ${real}`);
  }
  const rootReal = realpathWithin(root);
  if (!(real === rootReal || real.startsWith(rootReal + path.sep))) {
    throw new Error(`Refusing path escape: ${resolvedTarget} -> ${real}`);
  }
  return real;
}

/** Read text only if the file is a normal file under root (no symlink/hardlink). */
export function readTextWithin(target: string, root: string): string {
  const real = assertReadablePathWithin(target, root);
  return fs.readFileSync(real, "utf8");
}

/** Copy file only if source is unlinked regular file under fromRoot. */
export function copyFileWithin(
  from: string,
  fromRoot: string,
  to: string,
  allowedRoots: string[],
): void {
  assertReadablePathWithin(from, fromRoot);
  assertSafeWriteTarget(to, allowedRoots);
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

/** Used by apply.ts copyDir / applyDraft writes under vault Wiki. */
export function assertSafeWriteTarget(target: string, allowedRoots: string[]): void {
  if (pathHasOpenClaw(target)) {
    throw new Error(`Refusing path containing OpenClaw: ${target}`);
  }
  const abs = path.resolve(target);
  if (fs.existsSync(abs)) {
    const lst = fs.lstatSync(abs);
    if (lst.isSymbolicLink()) {
      throw new Error(`Refusing write through symlink: ${abs}`);
    }
    if (lst.isFile() && lst.nlink > 1) {
      throw new Error(`Refusing write through hardlink: ${abs}`);
    }
  }
  const resolved = realpathWithin(target);
  if (pathHasOpenClaw(resolved)) {
    throw new Error(`Refusing path containing OpenClaw: ${resolved}`);
  }
  const ok = allowedRoots.some((root) => {
    const r = realpathWithin(root);
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
