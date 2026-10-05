import { describe, expect, it } from "vitest";
import {
  Brief,
  Creator,
  CreatorScore,
  ErrorCode,
  QueryPlan,
  ScoreLine,
  clampFitScore,
} from "@/lib/schemas";
import {
  briefFixture,
  creatorFixture,
  creatorScoreFixture,
  queryPlanFixture,
} from "@/test/fixtures";

describe("Brief", () => {
  it("applies defaults and trims text", () => {
    const parsed = Brief.parse({
      brandName: "  Peak Fuel ",
      product: "Electrolyte mix",
      audience: "Runners",
    });
    expect(parsed).toEqual({
      brandName: "Peak Fuel",
      product: "Electrolyte mix",
      audience: "Runners",
      goal: "awareness",
      subscriberRange: "10k-100k",
      region: "any",
      language: "en",
      notes: "",
    });
  });

  it("rejects missing required fields", () => {
    const result = Brief.safeParse({ brandName: "X" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path[0]);
      expect(paths).toEqual(expect.arrayContaining(["product", "audience"]));
    }
  });

  it("rejects values outside the dropdown enums", () => {
    expect(Brief.safeParse({ ...briefFixture, goal: "virality" }).success).toBe(
      false,
    );
    expect(Brief.safeParse({ ...briefFixture, region: "ZZ" }).success).toBe(
      false,
    );
  });

  it("caps notes at 1000 characters", () => {
    const long = "x".repeat(1001);
    expect(Brief.safeParse({ ...briefFixture, notes: long }).success).toBe(
      false,
    );
  });
});

describe("Claude output and creator schemas", () => {
  it("parse the fixtures unchanged", () => {
    expect(QueryPlan.parse(queryPlanFixture)).toEqual(queryPlanFixture);
    expect(CreatorScore.parse(creatorScoreFixture)).toEqual(
      creatorScoreFixture,
    );
    expect(Creator.parse(creatorFixture)).toEqual(creatorFixture);
  });

  it("require a valid thumbnail url", () => {
    expect(
      Creator.safeParse({ ...creatorFixture, thumbnailUrl: "not a url" })
        .success,
    ).toBe(false);
  });

  it("clampFitScore rounds and clamps to 0..100", () => {
    const at = (fitScore: number) =>
      clampFitScore({ ...creatorScoreFixture, fitScore }).fitScore;
    expect(at(137.6)).toBe(100);
    expect(at(-3)).toBe(0);
    expect(at(71.4)).toBe(71);
    expect(at(71.5)).toBe(72);
    expect(at(Number.NaN)).toBe(0);
  });
});

describe("ScoreLine", () => {
  it("parses each variant and rejects unknown types", () => {
    expect(
      ScoreLine.parse({
        type: "score",
        channelId: "UC1",
        score: creatorScoreFixture,
        cached: false,
      }).type,
    ).toBe("score");
    expect(
      ScoreLine.parse({
        type: "error",
        channelId: "UC1",
        code: "llm_error",
        message: "overloaded",
        retryable: true,
      }).type,
    ).toBe("error");
    expect(ScoreLine.parse({ type: "done", scored: 2, failed: 0 }).type).toBe(
      "done",
    );
    expect(ScoreLine.safeParse({ type: "nope" }).success).toBe(false);
  });
});

describe("ErrorCode", () => {
  it("lists every code the routes use", () => {
    expect(ErrorCode.options).toEqual(
      expect.arrayContaining([
        "invalid_request",
        "not_found",
        "visitor_limit",
        "budget_exhausted",
        "score_cap",
        "youtube_error",
        "llm_error",
        "forbidden",
        "internal",
      ]),
    );
  });
});
