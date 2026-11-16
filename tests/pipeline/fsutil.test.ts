import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeJobId,
  assertSafeWriteTarget,
  pathHasOpenClaw,
} from "../../src/lib/fsutil.js";

describe("fsutil harness helpers", () => {
  it("detects OpenClaw segment case-insensitively", () => {
    expect(pathHasOpenClaw("/vault/OpenClaw/x.md")).toBe(true);
    expect(pathHasOpenClaw("/vault/openclaw/x.md")).toBe(true);
    expect(pathHasOpenClaw("/vault/Wiki/x.md")).toBe(false);
  });

  it("allows writes under allowed roots only", () => {
    expect(() =>
      assertSafeWriteTarget("/tmp/vault/Wiki/a.md", ["/tmp/vault"]),
    ).not.toThrow();
    expect(() =>
      assertSafeWriteTarget("/tmp/other/Wiki/a.md", ["/tmp/vault"]),
    ).toThrow(/allowed roots/);
  });

  it("rejects write via Wiki symlink escape", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsutil-symlink-"));
    const vault = path.join(root, "vault");
    const outside = path.join(root, "outside");
    fs.mkdirSync(path.join(vault, "Wiki"), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.rmSync(path.join(vault, "Wiki"), { recursive: true });
    fs.symlinkSync(outside, path.join(vault, "Wiki"));
    expect(() =>
      assertSafeWriteTarget(path.join(vault, "Wiki", "leak.md"), [vault]),
    ).toThrow(/allowed roots/);
  });

  it("rejects reading draft symlink escape", async () => {
    const { readTextWithin, copyFileWithin } = await import("../../src/lib/fsutil.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsutil-draft-"));
    const draft = path.join(root, "draft");
    const outside = path.join(root, "secret.txt");
    fs.mkdirSync(path.join(draft, "Wiki"), { recursive: true });
    fs.writeFileSync(outside, "secret\n", "utf8");
    const link = path.join(draft, "Wiki", "note.md");
    fs.symlinkSync(outside, link);
    expect(() => readTextWithin(link, draft)).toThrow(/escape|symlink/i);
    expect(() =>
      copyFileWithin(link, draft, path.join(root, "out.md"), [root]),
    ).toThrow(/symlink/i);
  });

  it("rejects hardlink draft sources", async () => {
    const { readTextWithin, copyFileWithin } = await import("../../src/lib/fsutil.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsutil-hardlink-"));
    const draft = path.join(root, "draft");
    const outside = path.join(root, "secret.txt");
    fs.mkdirSync(path.join(draft, "Wiki"), { recursive: true });
    fs.writeFileSync(outside, "secret\n", "utf8");
    const link = path.join(draft, "Wiki", "note.md");
    fs.linkSync(outside, link);
    expect(() => readTextWithin(link, draft)).toThrow(/hardlink/i);
    expect(() =>
      copyFileWithin(link, draft, path.join(root, "out.md"), [root]),
    ).toThrow(/hardlink/i);
  });

  it("rejects path-traversal job ids", () => {
    expect(assertSafeJobId("phase0-demo")).toBe("phase0-demo");
    expect(() => assertSafeJobId("../../outside")).toThrow(/Invalid job id/);
    expect(() => assertSafeJobId("..")).toThrow(/Invalid job id/);
    expect(() => assertSafeJobId(".")).toThrow(/Invalid job id/);
    expect(() => assertSafeJobId("foo/bar")).toThrow(/Invalid job id/);
    expect(assertSafeJobId("ask.smoke-1")).toBe("ask.smoke-1");
  });
});
