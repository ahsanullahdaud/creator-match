import { describe, expect, it } from "vitest";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";
import { briefId } from "@/lib/hash";
import { Brief } from "@/lib/schemas";

describe("EXAMPLE_BRIEFS", () => {
  it("has three briefs with unique slugs and ids", () => {
    expect(EXAMPLE_BRIEFS).toHaveLength(3);
    const slugs = EXAMPLE_BRIEFS.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(3);
    const ids = EXAMPLE_BRIEFS.map((e) => briefId(e.brief));
    expect(new Set(ids).size).toBe(3);
  });

  it("every brief is already normalized by the schema", () => {
    for (const example of EXAMPLE_BRIEFS) {
      expect(Brief.parse(example.brief)).toEqual(example.brief);
      expect(example.brief.notes).toBe("");
      expect(example.title.length).toBeGreaterThan(0);
      expect(example.blurb.length).toBeGreaterThan(0);
    }
  });
});
