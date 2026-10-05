import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/lib/cache";
import { getConfig } from "@/lib/config";
import { keys } from "@/lib/keys";
import { llmRequestsToday, reserveLlmRequest } from "@/lib/rate-limit";

describe("reserveLlmRequest", () => {
  it("counts requests under a Pacific-date key and refuses at the budget", async () => {
    const cache = new MemoryStore();
    const config = getConfig({ LLM_DAILY_REQUEST_BUDGET: "2" });
    const now = new Date("2026-10-05T06:30:00Z"); // still Oct 4 in Los Angeles

    expect(await reserveLlmRequest({ cache, config, now })).toBe(1);
    expect(await reserveLlmRequest({ cache, config, now })).toBe(2);
    await expect(
      reserveLlmRequest({ cache, config, now }),
    ).rejects.toMatchObject({ code: "budget_exhausted", status: 503 });
    expect(await llmRequestsToday(cache, now)).toBe(2);
    expect(await cache.get(keys.llmRequests(now))).toBe(2);
    expect(keys.llmRequests(now)).toBe("llm:requests:2026-10-04");
  });

  it("starts fresh on the next Pacific day", async () => {
    const cache = new MemoryStore();
    const config = getConfig({ LLM_DAILY_REQUEST_BUDGET: "1" });
    const day1 = new Date("2026-10-05T06:30:00Z");
    const day2 = new Date("2026-10-05T07:30:00Z"); // past midnight Pacific
    await reserveLlmRequest({ cache, config, now: day1 });
    await expect(
      reserveLlmRequest({ cache, config, now: day1 }),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(await reserveLlmRequest({ cache, config, now: day2 })).toBe(1);
  });

  it("uses the shared cache and config by default", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("LLM_DAILY_REQUEST_BUDGET", "5");
    expect(await reserveLlmRequest()).toBe(1);
  });
});

describe("reserveYoutubeSearch and budgetState", () => {
  it("applies the public threshold by default and the total one with bypass", async () => {
    const { MemoryStore } = await import("@/lib/cache");
    const { budgetState, reserveYoutubeSearch, youtubeSearchesToday } =
      await import("@/lib/rate-limit");
    const cache = new MemoryStore();
    const config = getConfig({
      YT_PUBLIC_SEARCH_BUDGET: "2",
      YT_TOTAL_SEARCH_BUDGET: "3",
    });
    const now = new Date("2026-10-05T12:00:00Z");
    expect(await reserveYoutubeSearch({ cache, config, now })).toBe(1);
    expect(await reserveYoutubeSearch({ cache, config, now })).toBe(2);
    await expect(
      reserveYoutubeSearch({ cache, config, now }),
    ).rejects.toMatchObject({
      code: "budget_exhausted",
    });
    expect(
      await reserveYoutubeSearch({ cache, config, now, bypass: true }),
    ).toBe(3);
    await expect(
      reserveYoutubeSearch({ cache, config, now, bypass: true }),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(await youtubeSearchesToday(cache, now)).toBe(3);
    expect(await cache.get(keys.ytSearches(now))).toBe(3);

    const wide = getConfig({ YT_PUBLIC_SEARCH_BUDGET: "60" });
    expect(budgetState(0, wide)).toBe("ok");
    expect(budgetState(50, wide)).toBe("ok");
    expect(budgetState(51, wide)).toBe("low");
    expect(budgetState(60, wide)).toBe("exhausted");
  });

  it("countYoutubeUnit increments the unit counter", async () => {
    const { MemoryStore } = await import("@/lib/cache");
    const { countYoutubeUnit } = await import("@/lib/rate-limit");
    const cache = new MemoryStore();
    const now = new Date("2026-10-05T12:00:00Z");
    expect(await countYoutubeUnit(cache, now)).toBe(1);
    expect(await countYoutubeUnit(cache, now)).toBe(2);
    expect(await cache.get(keys.ytUnits(now))).toBe(2);
  });
});

describe("visitor buckets", () => {
  it("clientIp prefers the first x-forwarded-for entry, then x-real-ip, then local", async () => {
    const { clientIp } = await import("@/lib/rate-limit");
    const make = (headers: Record<string, string>) =>
      new Request("http://localhost/x", { headers });
    expect(clientIp(make({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe(
      "203.0.113.5",
    );
    expect(clientIp(make({ "x-real-ip": "198.51.100.7" }))).toBe(
      "198.51.100.7",
    );
    expect(clientIp(make({}))).toBe("local");
  });

  it("visitorId hashes the ip with the salt", async () => {
    const { visitorId } = await import("@/lib/rate-limit");
    const request = new Request("http://localhost/x", {
      headers: { "x-forwarded-for": "203.0.113.5" },
    });
    const a = visitorId(request, getConfig({ RATE_LIMIT_SALT: "a" }));
    const b = visitorId(request, getConfig({ RATE_LIMIT_SALT: "b" }));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });

  it("search allowance counts down per visitor and day, and bypass ignores it", async () => {
    const { MemoryStore } = await import("@/lib/cache");
    const { checkVisitorSearch, countVisitorSearch, visitorSearchStatus } =
      await import("@/lib/rate-limit");
    const cache = new MemoryStore();
    const config = getConfig({ VISITOR_SEARCH_LIMIT: "2" });
    const now = new Date("2026-10-05T12:00:00Z");
    const me = { cache, config, now, visitor: "abc" };
    expect(await visitorSearchStatus(me)).toEqual({
      remaining: 2,
      limit: 2,
      bypass: false,
    });
    await countVisitorSearch(me);
    expect(await checkVisitorSearch(me)).toEqual({
      remaining: 1,
      limit: 2,
      bypass: false,
    });
    await countVisitorSearch(me);
    await expect(checkVisitorSearch(me)).rejects.toMatchObject({
      code: "visitor_limit",
      status: 429,
    });
    expect(
      await visitorSearchStatus({ ...me, visitor: "other" }),
    ).toMatchObject({ remaining: 2 });
    const tomorrow = new Date("2026-10-06T12:00:00Z");
    expect(await visitorSearchStatus({ ...me, now: tomorrow })).toMatchObject({
      remaining: 2,
    });
    expect(await checkVisitorSearch({ ...me, bypass: true })).toEqual({
      remaining: 2,
      limit: 2,
      bypass: true,
    });
    expect(await cache.get(keys.rlSearch("abc", now))).toBe(2);
  });

  it("brief allowance refuses at VISITOR_BRIEF_LIMIT unless bypassed", async () => {
    const { MemoryStore } = await import("@/lib/cache");
    const { checkVisitorBrief, countVisitorBrief } =
      await import("@/lib/rate-limit");
    const cache = new MemoryStore();
    const config = getConfig({ VISITOR_BRIEF_LIMIT: "1" });
    const me = { cache, config, visitor: "abc" };
    await expect(checkVisitorBrief(me)).resolves.toBeUndefined();
    await countVisitorBrief(me);
    await expect(checkVisitorBrief(me)).rejects.toMatchObject({
      code: "visitor_limit",
    });
    await expect(
      checkVisitorBrief({ ...me, bypass: true }),
    ).resolves.toBeUndefined();
  });
});

describe("budgetState with bypass and passcode attempts", () => {
  it("uses the total threshold for passcode holders", async () => {
    const { budgetState } = await import("@/lib/rate-limit");
    const config = getConfig({
      YT_PUBLIC_SEARCH_BUDGET: "60",
      YT_TOTAL_SEARCH_BUDGET: "95",
    });
    expect(budgetState(60, config)).toBe("exhausted");
    expect(budgetState(60, config, true)).toBe("ok");
    expect(budgetState(90, config, true)).toBe("low");
    expect(budgetState(95, config, true)).toBe("exhausted");
  });

  it("countPasscodeAttempt counts per visitor and day", async () => {
    const { MemoryStore } = await import("@/lib/cache");
    const { countPasscodeAttempt } = await import("@/lib/rate-limit");
    const cache = new MemoryStore();
    const now = new Date("2026-10-05T12:00:00Z");
    expect(await countPasscodeAttempt({ cache, now, visitor: "abc" })).toBe(1);
    expect(await countPasscodeAttempt({ cache, now, visitor: "abc" })).toBe(2);
    expect(await countPasscodeAttempt({ cache, now, visitor: "xyz" })).toBe(1);
    expect(await cache.get(keys.rlPasscode("abc", now))).toBe(2);
  });
});
