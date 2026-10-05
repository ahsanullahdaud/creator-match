import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/youtube", () => ({
  searchVideos: vi.fn(),
  getChannels: vi.fn(),
}));

import { POST } from "@/app/api/search/route";
import { getCache, resetCache } from "@/lib/cache";
import { AppError } from "@/lib/errors";
import { briefId } from "@/lib/hash";
import { keys } from "@/lib/keys";
import {
  ErrorResponse,
  SearchResponse,
  type SearchRecord,
} from "@/lib/schemas";
import { getChannels, searchVideos } from "@/lib/youtube";
import {
  briefFixture,
  channelInfoFixture,
  queryPlanFixture,
  searchHit,
} from "@/test/fixtures";

const searchMock = vi.mocked(searchVideos);
const channelsMock = vi.mocked(getChannels);

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.5",
      },
      body: JSON.stringify(body),
    }),
  );
}

async function seedBrief(): Promise<string> {
  const id = briefId(briefFixture);
  await getCache().set(
    keys.brief(id),
    {
      briefId: id,
      brief: briefFixture,
      queries: queryPlanFixture,
      createdAt: "2026-10-05T00:00:00Z",
    },
    3600,
  );
  return id;
}

function happyMocks() {
  searchMock
    .mockResolvedValueOnce({
      live: true,
      hits: [searchHit("A", "v1"), searchHit("B", "v2"), searchHit("C", "v3")],
    })
    .mockResolvedValueOnce({
      live: true,
      hits: [searchHit("A", "v4"), searchHit("D", "v5")],
    })
    .mockResolvedValueOnce({
      live: true,
      hits: [searchHit("A", "v6"), searchHit("B", "v7")],
    });
  channelsMock.mockResolvedValueOnce(
    ["A", "B", "C", "D"].map((id) => channelInfoFixture(id)),
  );
}

describe("POST /api/search", () => {
  beforeEach(() => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("YT_PUBLIC_SEARCH_BUDGET", "");
    resetCache();
    searchMock.mockReset();
    channelsMock.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("rejects an unknown brief and an invalid body", async () => {
    const missing = await post({ briefId: "0123456789abcdef" });
    expect(missing.status).toBe(404);
    const invalid = await post({ briefId: "short" });
    expect(invalid.status).toBe(400);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("searches each query, ranks creators, and stores the record", async () => {
    const id = await seedBrief();
    happyMocks();
    const res = await post({ briefId: id });
    expect(res.status).toBe(200);
    const body = SearchResponse.parse(await res.json());
    expect(body.cached).toBe(false);
    expect(body.creators.map((c) => c.channelId)).toEqual(["A", "B", "C", "D"]);
    expect(body.creators[0].hits).toBe(3);
    expect(body.creators[0].matchedVideos.map((v) => v.videoId)).toEqual([
      "v1",
      "v4",
      "v6",
    ]);
    expect(body.visitor).toEqual({ remaining: 3, limit: 3, bypass: false });
    expect(body.budget).toBe("ok");
    expect(searchMock).toHaveBeenCalledTimes(3);
    expect(searchMock.mock.calls[0]).toEqual([
      queryPlanFixture.queries[0].q,
      "US",
      "en",
    ]);
    expect(channelsMock).toHaveBeenCalledWith(["A", "B", "C", "D"]);
    const record = await getCache().get<SearchRecord>(keys.search(id));
    expect(record?.liveSearches).toBe(3);
    expect(record?.creators).toHaveLength(4);
  });

  it("serves the second call from cache without touching YouTube", async () => {
    const id = await seedBrief();
    happyMocks();
    await post({ briefId: id });
    const res = await post({ briefId: id });
    const body = SearchResponse.parse(await res.json());
    expect(body.cached).toBe(true);
    expect(body.creators).toHaveLength(4);
    expect(searchMock).toHaveBeenCalledTimes(3);
    expect(channelsMock).toHaveBeenCalledTimes(1);
  });

  it("returns 503 budget_exhausted when no query could run", async () => {
    const id = await seedBrief();
    searchMock.mockRejectedValue(new AppError("budget_exhausted", "spent"));
    const res = await post({ briefId: id });
    expect(res.status).toBe(503);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe(
      "budget_exhausted",
    );
    expect(channelsMock).not.toHaveBeenCalled();
    expect(await getCache().get(keys.search(id))).toBeNull();
  });

  it("proceeds with the queries that did run when one fails", async () => {
    const id = await seedBrief();
    searchMock
      .mockRejectedValueOnce(new AppError("budget_exhausted", "spent"))
      .mockResolvedValueOnce({ live: false, hits: [searchHit("A", "v1")] })
      .mockResolvedValueOnce({ live: true, hits: [searchHit("B", "v2")] });
    channelsMock.mockResolvedValueOnce([
      channelInfoFixture("A"),
      channelInfoFixture("B"),
    ]);
    const res = await post({ briefId: id });
    expect(res.status).toBe(200);
    const body = SearchResponse.parse(await res.json());
    expect(body.creators).toHaveLength(2);
    expect(
      (await getCache().get<SearchRecord>(keys.search(id)))?.liveSearches,
    ).toBe(1);
  });

  it("returns 502 when YouTube itself fails on every query", async () => {
    const id = await seedBrief();
    searchMock.mockRejectedValue(
      new AppError("youtube_error", "down", { retryable: true }),
    );
    const res = await post({ briefId: id });
    expect(res.status).toBe(502);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe(
      "youtube_error",
    );
  });

  it("caches an empty result when nothing fits the size range", async () => {
    const id = await seedBrief();
    searchMock.mockResolvedValue({
      live: true,
      hits: [searchHit("BIG", "v1")],
    });
    channelsMock.mockResolvedValueOnce([
      channelInfoFixture("BIG", { subscriberCount: 5_000_000 }),
    ]);
    const res = await post({ briefId: id });
    const body = SearchResponse.parse(await res.json());
    expect(body.creators).toEqual([]);
    expect(
      (await getCache().get<SearchRecord>(keys.search(id)))?.creators,
    ).toEqual([]);
  });

  it("reports the budget state from today's search counter", async () => {
    const id = await seedBrief();
    await getCache().set(keys.ytSearches(), 55, 3600);
    happyMocks();
    const low = SearchResponse.parse(
      await (await post({ briefId: id })).json(),
    );
    expect(low.budget).toBe("low");
    await getCache().set(keys.ytSearches(), 60, 3600);
    const spent = SearchResponse.parse(
      await (await post({ briefId: id })).json(),
    );
    expect(spent.cached).toBe(true);
    expect(spent.budget).toBe("exhausted");
  });
});
