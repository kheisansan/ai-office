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

  it("rejects path-traversal job ids", () => {
    expect(assertSafeJobId("phase0-demo")).toBe("phase0-demo");
    expect(() => assertSafeJobId("../../outside")).toThrow(/Invalid job id/);
    expect(() => assertSafeJobId("..")).toThrow(/Invalid job id/);
    expect(() => assertSafeJobId(".")).toThrow(/Invalid job id/);
    expect(() => assertSafeJobId("foo/bar")).toThrow(/Invalid job id/);
    expect(assertSafeJobId("ask.smoke-1")).toBe("ask.smoke-1");
  });
});
