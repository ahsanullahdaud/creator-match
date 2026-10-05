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
