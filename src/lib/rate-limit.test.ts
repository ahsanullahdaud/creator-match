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
