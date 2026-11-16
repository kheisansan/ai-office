import { describe, expect, it } from "vitest";
import {
  assertSafeHttpUrl,
  assertSafeHttpUrlLiteral,
  assertSafeIngestUrl,
} from "../../src/lib/safe-url.js";

describe("assertSafeHttpUrlLiteral", () => {
  it("accepts public http(s) urls", () => {
    expect(assertSafeHttpUrlLiteral("https://youtu.be/abc").href).toBe(
      "https://youtu.be/abc",
    );
    expect(assertSafeHttpUrlLiteral("http://example.com/x").hostname).toBe("example.com");
  });

  it("rejects empty, option-like, and non-http schemes", () => {
    expect(() => assertSafeHttpUrlLiteral("")).toThrow(/url required/);
    expect(() => assertSafeHttpUrlLiteral("--help")).toThrow(/must not start with -/);
    expect(() => assertSafeHttpUrlLiteral("file:///etc/passwd")).toThrow(/http or https/);
    expect(() => assertSafeHttpUrlLiteral("javascript:alert(1)")).toThrow(/http or https/);
    expect(() => assertSafeHttpUrlLiteral("not a url")).toThrow(/invalid url/);
  });

  it("rejects localhost and private hosts", () => {
    expect(() => assertSafeHttpUrlLiteral("http://127.0.0.1/x")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://localhost/x")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://192.168.1.1/x")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://10.0.0.2/x")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://169.254.169.254/")).toThrow(/not allowed/);
  });

  it("rejects trailing-dot and IPv6 mapped/compatible / SSRF helpers", () => {
    expect(() => assertSafeHttpUrlLiteral("http://localhost./")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://localtest.me./")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://metadata.google.internal./")).toThrow(
      /not allowed/,
    );
    expect(() => assertSafeHttpUrlLiteral("http://[::ffff:127.0.0.1]/")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://[::ffff:7f00:1]/")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://[::ffff:a00:1]/")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://[::127.0.0.1]/")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://[::7f00:1]/")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://[::ffff:0:127.0.0.1]/")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://[fc00::1]/")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://[fe80::1]/")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://127.0.0.1.nip.io/")).toThrow(/not allowed/);
    expect(() => assertSafeHttpUrlLiteral("http://localtest.me/")).toThrow(/not allowed/);
  });
});

describe("assertSafeHttpUrl DNS", () => {
  it("rejects hosts that resolve to private addresses", async () => {
    await expect(
      assertSafeHttpUrl("https://evil.example/", {
        lookup: async () => ["127.0.0.1"],
      }),
    ).rejects.toThrow(/not allowed/);
    await expect(
      assertSafeHttpUrl("https://evil.example/", {
        lookup: async () => ["169.254.169.254"],
      }),
    ).rejects.toThrow(/not allowed/);
  });

  it("accepts hosts that resolve to public addresses", async () => {
    const safe = await assertSafeHttpUrl("https://youtu.be/abc", {
      lookup: async () => ["142.250.1.1"],
    });
    expect(safe.hostname).toBe("youtu.be");
  });
});

describe("assertSafeIngestUrl", () => {
  it("allows YouTube hosts only", async () => {
    const yt = await assertSafeIngestUrl("https://www.youtube.com/watch?v=abc", {
      lookup: async () => ["142.250.1.1"],
    });
    expect(yt.hostname).toBe("www.youtube.com");

    await expect(
      assertSafeIngestUrl("https://example.com/watch?v=abc", {
        lookup: async () => ["93.184.216.34"],
      }),
    ).rejects.toThrow(/YouTube/);
  });
});
