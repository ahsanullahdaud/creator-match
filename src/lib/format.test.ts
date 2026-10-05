import { describe, expect, it } from "vitest";
import { formatCount } from "@/lib/format";

describe("formatCount", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(1_234)).toBe("1.2K");
    expect(formatCount(42_000)).toBe("42K");
    expect(formatCount(999_999)).toBe("1000K");
    expect(formatCount(1_500_000)).toBe("1.5M");
    expect(formatCount(12_345_678)).toBe("12M");
  });
});

describe("decodeHtml", () => {
  it("decodes the entities YouTube uses in titles and leaves the rest alone", async () => {
    const { decodeHtml } = await import("@/lib/format");
    expect(decodeHtml("How Much to Eat, Drink &amp; When")).toBe(
      "How Much to Eat, Drink & When",
    );
    expect(decodeHtml("here&#39;s how I &quot;fuel&quot;")).toBe(
      'here\'s how I "fuel"',
    );
    expect(decodeHtml("a &lt;b&gt; &#x1F3C3; c")).toBe("a <b> \u{1F3C3} c");
    expect(decodeHtml("plain & simple &unknown;")).toBe(
      "plain & simple &unknown;",
    );
  });
});
