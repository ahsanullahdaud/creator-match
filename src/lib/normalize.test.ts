import { describe, expect, it } from "vitest";
import { briefId } from "@/lib/hash";
import { normalizeText, sameBrief } from "@/lib/normalize";
import { briefFixture } from "@/test/fixtures";

describe("sameBrief", () => {
  it("agrees with briefId on what counts as the same brief", () => {
    const spaced = { ...briefFixture, brandName: "  PEAK   fuel labs " };
    expect(sameBrief(briefFixture, spaced)).toBe(true);
    expect(briefId(spaced)).toBe(briefId(briefFixture));
    const changed = { ...briefFixture, notes: "x" };
    expect(sameBrief(briefFixture, changed)).toBe(false);
    expect(briefId(changed)).not.toBe(briefId(briefFixture));
    expect(normalizeText(" A  b ")).toBe("a b");
  });
});
