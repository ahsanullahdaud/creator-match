import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as unknown[][],
  store: new Map<string, string>(),
}));

vi.mock("@upstash/redis", () => {
  class Redis {
    constructor(options: unknown) {
      mocks.calls.push(["construct", options]);
    }
    async get(key: string) {
      return mocks.store.get(key) ?? null;
    }
    async set(key: string, value: string, options?: unknown) {
      mocks.store.set(key, value);
      mocks.calls.push(["set", key, options]);
      return "OK";
    }
    async incr(key: string) {
      const next = Number(mocks.store.get(key) ?? "0") + 1;
      mocks.store.set(key, String(next));
      mocks.calls.push(["incr", key]);
      return next;
    }
    async expire(key: string, seconds: number) {
      mocks.calls.push(["expire", key, seconds]);
      return 1;
    }
    async del(key: string) {
      mocks.store.delete(key);
      return 1;
    }
  }
  return { Redis };
});

import { Redis } from "@upstash/redis";
import { MemoryStore, RedisStore, getCache, resetCache } from "@/lib/cache";

describe("MemoryStore", () => {
  it("round-trips JSON values and isolates them from later mutation", async () => {
    const store = new MemoryStore();
    const value = { creators: [{ id: "a" }], count: 2 };
    await store.set("k", value, 60);
    value.count = 99;
    expect(await store.get<typeof value>("k")).toEqual({
      creators: [{ id: "a" }],
      count: 2,
    });
    expect(await store.get("missing")).toBeNull();
  });

  it("expires entries after the ttl", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore();
    await store.set("k", 1, 10);
    vi.advanceTimersByTime(9_999);
    expect(await store.get("k")).toBe(1);
    vi.advanceTimersByTime(2);
    expect(await store.get("k")).toBeNull();
    expect(store.size).toBe(0);
  });

  it("incr starts at 1, keeps the first expiry, and restarts after it", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore();
    expect(await store.incr("c", 10)).toBe(1);
    vi.advanceTimersByTime(8_000);
    expect(await store.incr("c", 10)).toBe(2);
    vi.advanceTimersByTime(2_001); // past the original expiry, not the second call's
    expect(await store.get("c")).toBeNull();
    expect(await store.incr("c", 10)).toBe(1);
  });

  it("del and clear remove entries", async () => {
    const store = new MemoryStore();
    await store.set("a", 1, 60);
    await store.set("b", 2, 60);
    await store.del("a");
    expect(await store.get("a")).toBeNull();
    expect(store.size).toBe(1);
    store.clear();
    expect(store.size).toBe(0);
  });
});

describe("RedisStore", () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.store.clear();
  });

  it("stores JSON with an expiry and parses it back", async () => {
    const store = new RedisStore(new Redis({ url: "https://x", token: "t" }));
    await store.set("k", { a: 1 }, 60);
    expect(mocks.calls).toContainEqual(["set", "k", { ex: 60 }]);
    expect(mocks.store.get("k")).toBe('{"a":1}');
    expect(await store.get("k")).toEqual({ a: 1 });
    expect(await store.get("missing")).toBeNull();
  });

  it("sets the ttl only on the first increment", async () => {
    const store = new RedisStore(new Redis({ url: "https://x", token: "t" }));
    expect(await store.incr("c", 100)).toBe(1);
    expect(await store.incr("c", 100)).toBe(2);
    const expires = mocks.calls.filter((call) => call[0] === "expire");
    expect(expires).toEqual([["expire", "c", 100]]);
  });
});

describe("getCache", () => {
  it("uses the memory store when the KV variables are unset and reuses it", () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    resetCache();
    const cache = getCache();
    expect(cache.kind).toBe("memory");
    expect(getCache()).toBe(cache);
  });

  it("uses redis with JSON handled locally when both KV variables are set", () => {
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "token");
    resetCache();
    mocks.calls.length = 0;
    expect(getCache().kind).toBe("redis");
    expect(mocks.calls).toContainEqual([
      "construct",
      {
        url: "https://example.upstash.io",
        token: "token",
        automaticDeserialization: false,
      },
    ]);
  });

  it("falls back to memory when only one KV variable is set", () => {
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    resetCache();
    expect(getCache().kind).toBe("memory");
  });
});
