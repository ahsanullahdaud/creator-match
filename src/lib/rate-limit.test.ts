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
