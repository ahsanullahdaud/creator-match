import { describe, expect, it, vi } from "vitest";
import { LIMITS, TTL_SECONDS, getConfig, hasRedis } from "@/lib/config";

const KEYS = [
  "ANTHROPIC_API_KEY",
  "YOUTUBE_API_KEY",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "DEMO_PASSCODE",
  "RATE_LIMIT_SALT",
  "CLAUDE_QUERY_MODEL",
  "CLAUDE_SCORE_MODEL",
  "SCORE_CONCURRENCY",
  "CLAUDE_MAX_RETRIES",
  "CLAUDE_TIMEOUT_MS",
  "VISITOR_SEARCH_LIMIT",
  "VISITOR_BRIEF_LIMIT",
  "YT_PUBLIC_SEARCH_BUDGET",
  "YT_TOTAL_SEARCH_BUDGET",
];

/** Empty strings mimic a copied .env.example and must read as unset. */
function clearEnv() {
  for (const key of KEYS) vi.stubEnv(key, "");
}

describe("getConfig", () => {
  it("falls back to defaults when variables are unset or empty", () => {
    clearEnv();
    const config = getConfig();
    expect(config.ANTHROPIC_API_KEY).toBeUndefined();
    expect(config.CLAUDE_QUERY_MODEL).toBe("claude-haiku-4-5");
    expect(config.CLAUDE_SCORE_MODEL).toBe("claude-sonnet-5-5");
    expect(config.SCORE_CONCURRENCY).toBe(5);
    expect(config.CLAUDE_MAX_RETRIES).toBe(3);
    expect(config.CLAUDE_TIMEOUT_MS).toBe(30_000);
    expect(config.VISITOR_SEARCH_LIMIT).toBe(3);
    expect(config.VISITOR_BRIEF_LIMIT).toBe(10);
    expect(config.YT_PUBLIC_SEARCH_BUDGET).toBe(60);
    expect(config.YT_TOTAL_SEARCH_BUDGET).toBe(95);
    expect(config.RATE_LIMIT_SALT).toBe("dev-salt");
    expect(hasRedis(config)).toBe(false);
  });

  it("reads overrides and coerces numbers", () => {
    clearEnv();
    vi.stubEnv("SCORE_CONCURRENCY", "7");
    vi.stubEnv("VISITOR_SEARCH_LIMIT", "1");
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "token");
    const config = getConfig();
    expect(config.SCORE_CONCURRENCY).toBe(7);
    expect(config.VISITOR_SEARCH_LIMIT).toBe(1);
    expect(hasRedis(config)).toBe(true);
  });

  it("rejects a non-numeric limit with the variable name in the message", () => {
    clearEnv();
    vi.stubEnv("VISITOR_SEARCH_LIMIT", "many");
    expect(() => getConfig()).toThrow(/VISITOR_SEARCH_LIMIT/);
  });

  it("rejects a public search budget above the total budget", () => {
    clearEnv();
    vi.stubEnv("YT_PUBLIC_SEARCH_BUDGET", "96");
    vi.stubEnv("YT_TOTAL_SEARCH_BUDGET", "95");
    expect(() => getConfig()).toThrow(/YT_PUBLIC_SEARCH_BUDGET/);
  });

  it("rejects a search budget above YouTube's daily cap", () => {
    clearEnv();
    vi.stubEnv("YT_TOTAL_SEARCH_BUDGET", "101");
    expect(() => getConfig()).toThrow(/YT_TOTAL_SEARCH_BUDGET/);
  });

  it("accepts an explicit env object", () => {
    expect(getConfig({ SCORE_CONCURRENCY: "2" }).SCORE_CONCURRENCY).toBe(2);
  });

  it("keeps the fixed limits and TTLs the plan relies on", () => {
    expect(LIMITS.MAX_QUERIES).toBe(3);
    expect(LIMITS.MAX_CREATORS).toBe(10);
    expect(LIMITS.YT_SEARCH_DAILY_CAP).toBe(100);
    expect(TTL_SECONDS.ytChannel).toBe(24 * 3600);
    expect(TTL_SECONDS.brief).toBe(7 * 24 * 3600);
  });
});
