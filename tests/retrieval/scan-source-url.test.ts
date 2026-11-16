import { describe, expect, it } from "vitest";
import { extractSourceUrl } from "../../src/retrieval/scan.js";

describe("extractSourceUrl", () => {
  it("reads trusted frontmatter keys only", () => {
    expect(
      extractSourceUrl({ source_url: "https://youtu.be/abc" }, "## Sources\n- https://evil.example/"),
    ).toBe("https://youtu.be/abc");
    expect(
      extractSourceUrl({ sourceUrl: "https://example.com/a" }, "body"),
    ).toBe("https://example.com/a");
  });

  it("ignores body Sources even when frontmatter has no url", () => {
    expect(
      extractSourceUrl({}, "## Sources\n- https://youtu.be/from-body"),
    ).toBeUndefined();
    expect(
      extractSourceUrl({ source_url: "ftp://not-http" }, "## Sources\n- https://ok"),
    ).toBeUndefined();
  });
});
