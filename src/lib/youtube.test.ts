import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCache, resetCache } from "@/lib/cache";
import { keys } from "@/lib/keys";
import { getChannels, searchVideos } from "@/lib/youtube";
import { youtubeChannelItem, youtubeSearchResponse } from "@/test/fixtures";

const KEY = "secret-key-123";
const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function calledUrl(index = 0): URL {
  return new URL(fetchMock.mock.calls[index][0] as string);
}

beforeEach(() => {
  vi.stubEnv("YOUTUBE_API_KEY", KEY);
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("KV_REST_API_TOKEN", "");
  vi.stubEnv("YT_PUBLIC_SEARCH_BUDGET", "");
  resetCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchVideos", () => {
  it("calls search.list with the right params, caches by query, counts one search", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        youtubeSearchResponse([
          { channelId: "A", videoId: "v1" },
          { channelId: "B", videoId: "v2" },
          { channelId: "A", videoId: "v3" },
        ]),
      ),
    );
    const first = await searchVideos("Marathon  Training", "US", "en");
    expect(first.live).toBe(true);
    expect(first.hits).toHaveLength(3);
    expect(first.hits[0]).toEqual({
      channelId: "A",
      videoId: "v1",
      title: "Video v1",
      publishedAt: "2026-09-01T00:00:00Z",
    });
    const url = calledUrl();
    expect(url.pathname).toBe("/youtube/v3/search");
    expect(url.searchParams.get("type")).toBe("video");
    expect(url.searchParams.get("maxResults")).toBe("50");
    expect(url.searchParams.get("regionCode")).toBe("US");
    expect(url.searchParams.get("relevanceLanguage")).toBe("en");
    expect(url.searchParams.get("q")).toBe("Marathon  Training");
    expect(url.searchParams.get("key")).toBe(KEY);

    const second = await searchVideos("marathon training", "US", "en");
    expect(second.live).toBe(false);
    expect(second.hits).toEqual(first.hits);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getCache().get(keys.ytSearches())).toBe(1);
  });

  it("omits the region and language filters when they are 'any'", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(youtubeSearchResponse([])));
    await searchVideos("x", "any", "any");
    const url = calledUrl();
    expect(url.searchParams.has("regionCode")).toBe(false);
    expect(url.searchParams.has("relevanceLanguage")).toBe(false);
  });

  it("refuses before calling YouTube once the public search budget is spent", async () => {
    vi.stubEnv("YT_PUBLIC_SEARCH_BUDGET", "2");
    await getCache().set(keys.ytSearches(), 2, 3600);
    await expect(searchVideos("x", "any", "any")).rejects.toMatchObject({
      code: "budget_exhausted",
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps quotaExceeded to budget_exhausted without leaking the key", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 403,
            message:
              "The request cannot be completed because you have exceeded your quota.",
            errors: [{ reason: "quotaExceeded" }],
          },
        },
        403,
      ),
    );
    const error = await searchVideos("y", "any", "any").catch((e) => e);
    expect(error).toMatchObject({ code: "budget_exhausted", status: 503 });
    expect(String(error.message)).not.toContain(KEY);
  });

  it("maps other failures to youtube_error, retryable only for 5xx", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 400,
            message: "API key not valid",
            errors: [{ reason: "keyInvalid" }],
          },
        },
        400,
      ),
    );
    const bad = await searchVideos("a", "any", "any").catch((e) => e);
    expect(bad).toMatchObject({ code: "youtube_error", retryable: false });
    expect(bad.message).toMatch(/keyInvalid/);
    expect(bad.message).not.toContain(KEY);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: "Backend" } }, 503),
    );
    const down = await searchVideos("b", "any", "any").catch((e) => e);
    expect(down).toMatchObject({ code: "youtube_error", retryable: true });
  });

  it("skips items without a video id or channel id", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: { kind: "youtube#channel", channelId: "X" },
            snippet: { channelId: "X" },
          },
          { id: { videoId: "v9" }, snippet: {} },
          {
            id: { videoId: "v1" },
            snippet: {
              channelId: "A",
              title: "ok",
              publishedAt: "2026-01-01T00:00:00Z",
            },
          },
        ],
      }),
    );
    const result = await searchVideos("c", "any", "any");
    expect(result.hits.map((h) => h.videoId)).toEqual(["v1"]);
  });
});

describe("getChannels", () => {
  it("fetches only uncached ids in one call, caches each, counts one unit, keeps order", async () => {
    const cache = getCache();
    await cache.set(
      keys.ytChannel("B"),
      {
        channelId: "B",
        title: "Cached B",
        description: "",
        thumbnailUrl: "https://yt3.ggpht.com/B",
        subscriberCount: 1,
        videoCount: 9,
        viewCount: 9,
        hiddenSubscriberCount: false,
      },
      3600,
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          youtubeChannelItem("C", { country: "GB" }),
          youtubeChannelItem("A"),
        ],
      }),
    );
    const channels = await getChannels(["A", "B", "C", "A"]);
    expect(channels.map((c) => c.channelId)).toEqual(["A", "B", "C"]);
    expect(channels[1].title).toBe("Cached B");
    expect(channels[2].country).toBe("GB");
    const url = calledUrl();
    expect(url.pathname).toBe("/youtube/v3/channels");
    expect(url.searchParams.get("id")).toBe("A,C");
    expect(url.searchParams.get("part")).toBe("snippet,statistics");
    expect(await cache.get(keys.ytChannel("A"))).toMatchObject({
      handle: "@a",
    });
    expect(await cache.get(keys.ytUnits())).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("parses numeric strings, handles, and falls back when thumbnails are missing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          youtubeChannelItem("A", {
            subscriberCount: 123_456,
            hidden: true,
            customUrl: "c/legacy",
          }),
          youtubeChannelItem("B", { thumbnails: false }),
        ],
      }),
    );
    const [a, b] = await getChannels(["A", "B"]);
    expect(a.subscriberCount).toBe(123_456);
    expect(a.hiddenSubscriberCount).toBe(true);
    expect(a.handle).toBeUndefined();
    expect(b.thumbnailUrl).toMatch(/^https:\/\/www\.gstatic\.com\//);
  });

  it("makes no request when everything is cached", async () => {
    await getCache().set(
      keys.ytChannel("A"),
      {
        channelId: "A",
        title: "A",
        description: "",
        thumbnailUrl: "https://yt3.ggpht.com/A",
        subscriberCount: 1,
        videoCount: 9,
        viewCount: 9,
        hiddenSubscriberCount: false,
      },
      3600,
    );
    const channels = await getChannels(["A"]);
    expect(channels).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await getCache().get(keys.ytUnits())).toBeNull();
  });
});
