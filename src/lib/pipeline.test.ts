import { describe, expect, it } from "vitest";
import {
  aggregateHits,
  eligible,
  pickCandidates,
  rankCreators,
  selectCreators,
  subscriberBounds,
  toCreator,
  type ChannelHits,
} from "@/lib/pipeline";
import type { Brief } from "@/lib/schemas";
import { briefFixture, channelInfoFixture, searchHit } from "@/test/fixtures";

const NOW = new Date("2026-10-05T12:00:00Z");

function hits(
  channelId: string,
  n: number,
  latest = "2026-09-20T00:00:00Z",
): ChannelHits {
  return {
    channelId,
    hits: n,
    latest,
    videos: [{ videoId: `${channelId}-v`, title: "t", publishedAt: latest }],
  };
}

describe("aggregateHits", () => {
  it("counts a channel once per query and keeps the three newest videos", () => {
    const q1 = [
      searchHit("A", "v1", "2026-09-01T00:00:00Z"),
      searchHit("A", "v2", "2026-09-10T00:00:00Z"),
      searchHit("B", "v3", "2026-08-01T00:00:00Z"),
    ];
    const q2 = [
      searchHit("A", "v4", "2026-07-01T00:00:00Z"),
      searchHit("A", "v1", "2026-09-01T00:00:00Z"),
      searchHit("C", "v5", "2026-09-20T00:00:00Z"),
    ];
    const q3 = [searchHit("A", "v6", "2026-06-01T00:00:00Z")];
    const agg = aggregateHits([q1, q2, q3]);
    const a = agg.find((c) => c.channelId === "A");
    expect(a?.hits).toBe(3);
    expect(a?.videos.map((v) => v.videoId)).toEqual(["v2", "v1", "v4"]);
    expect(a?.latest).toBe("2026-09-10T00:00:00Z");
    expect(agg.find((c) => c.channelId === "B")?.hits).toBe(1);
    expect(agg).toHaveLength(3);
  });
});

describe("pickCandidates", () => {
  it("orders by hits, then newest video, and caps the list", () => {
    const picked = pickCandidates(
      [
        hits("old", 1, "2024-01-01T00:00:00Z"),
        hits("top", 3),
        hits("new", 1, "2026-10-01T00:00:00Z"),
        hits("mid", 2),
      ],
      3,
    );
    expect(picked.map((c) => c.channelId)).toEqual(["top", "mid", "new"]);
  });
});

describe("subscriberBounds and eligible", () => {
  it("treats the upper bound as exclusive and 'any' as unbounded", () => {
    expect(subscriberBounds("10k-100k")).toEqual([10_000, 100_000]);
    expect(subscriberBounds("any")).toEqual([0, Number.POSITIVE_INFINITY]);
    const brief = briefFixture; // 10k-100k
    const at = (n: number) =>
      eligible(channelInfoFixture("X", { subscriberCount: n }), brief);
    expect(at(9_999)).toBe(false);
    expect(at(10_000)).toBe(true);
    expect(at(99_999)).toBe(true);
    expect(at(100_000)).toBe(false);
    const any: Brief = { ...brief, subscriberRange: "any" };
    expect(eligible(channelInfoFixture("Y", { subscriberCount: 5 }), any)).toBe(
      true,
    );
    const big: Brief = { ...brief, subscriberRange: "1m-plus" };
    expect(
      eligible(channelInfoFixture("Z", { subscriberCount: 999_999 }), big),
    ).toBe(false);
    expect(
      eligible(channelInfoFixture("Z", { subscriberCount: 1_000_000 }), big),
    ).toBe(true);
  });

  it("drops hidden subscriber counts and channels with too few videos", () => {
    expect(
      eligible(
        channelInfoFixture("H", { hiddenSubscriberCount: true }),
        briefFixture,
      ),
    ).toBe(false);
    expect(
      eligible(channelInfoFixture("F", { videoCount: 4 }), briefFixture),
    ).toBe(false);
    expect(
      eligible(channelInfoFixture("F", { videoCount: 5 }), briefFixture),
    ).toBe(true);
  });
});

describe("toCreator", () => {
  it("builds the channel url from the handle and trims the description", () => {
    const long = "x".repeat(400);
    const withHandle = toCreator(
      channelInfoFixture("A", { description: long }),
      hits("A", 2),
    );
    expect(withHandle.url).toBe("https://www.youtube.com/@a");
    expect(withHandle.description).toHaveLength(300);
    expect(withHandle.hits).toBe(2);
    const noHandle = toCreator(
      channelInfoFixture("B", { handle: undefined }),
      hits("B", 1),
    );
    expect(noHandle.url).toBe("https://www.youtube.com/channel/B");
  });
});

describe("rankCreators and selectCreators", () => {
  it("ranks by hits, then recency, then region, then subscribers", () => {
    const channels = [
      channelInfoFixture("A", { country: "US", subscriberCount: 42_000 }),
      channelInfoFixture("B", { country: undefined }),
      channelInfoFixture("C", { country: "GB" }),
      channelInfoFixture("D", { country: "US", subscriberCount: 80_000 }),
    ];
    const agg = [
      hits("A", 1, "2026-09-25T00:00:00Z"), // 3 + 1 + 1 + 1 = 6
      hits("B", 2, "2025-01-01T00:00:00Z"), // 6 + 1 + 0 + 0 = 7
      hits("C", 1, "2026-09-20T00:00:00Z"), // 3 + 1 + 1 + 0 = 5
      hits("D", 1, "2026-09-20T00:00:00Z"), // 3 + 1 + 1 + 1 = 6, more subs than A
    ];
    const ranked = selectCreators(channels, agg, briefFixture, NOW);
    expect(ranked.map((c) => c.channelId)).toEqual(["B", "D", "A", "C"]);
  });

  it("drops ineligible channels and channels without hits, and caps at 10", () => {
    const channels = Array.from({ length: 14 }, (_, i) =>
      channelInfoFixture(`C${i}`, {
        subscriberCount: i === 0 ? 5_000_000 : 50_000,
      }),
    );
    const agg = channels.slice(0, 13).map((c) => hits(c.channelId, 1));
    const ranked = rankCreators(
      selectCreators(channels, agg, briefFixture, NOW),
      briefFixture,
      NOW,
    );
    expect(ranked).toHaveLength(10);
    expect(ranked.map((c) => c.channelId)).not.toContain("C0"); // out of range
    expect(ranked.map((c) => c.channelId)).not.toContain("C13"); // no hits
  });
});
