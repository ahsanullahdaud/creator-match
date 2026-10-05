import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/status/route";
import { resetCache } from "@/lib/cache";
import { StatusResponse } from "@/lib/schemas";

describe("GET /api/status", () => {
  it("reports the memory store and default limits when no KV env is set", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("VISITOR_SEARCH_LIMIT", "");
    resetCache();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await GET(new Request("http://localhost/api/status"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = StatusResponse.parse(await res.json());
    expect(body).toEqual({
      visitor: { remaining: 3, limit: 3, bypass: false },
      budget: "ok",
      maxCreators: 10,
      store: "memory",
      examples: [],
    });

    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(log.mock.calls[0][0] as string);
    expect(line).toMatchObject({ route: "status", method: "GET", status: 200 });
    expect(typeof line.ms).toBe("number");
    expect(typeof line.cache_ms).toBe("number");
  });

  it("reflects an overridden visitor limit", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("VISITOR_SEARCH_LIMIT", "1");
    resetCache();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await GET(new Request("http://localhost/api/status"));
    const body = StatusResponse.parse(await res.json());
    expect(body.visitor).toEqual({ remaining: 1, limit: 1, bypass: false });
  });
});

describe("GET /api/status budget", () => {
  it("reflects today's search counter", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("YT_PUBLIC_SEARCH_BUDGET", "");
    resetCache();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { getCache } = await import("@/lib/cache");
    const { keys } = await import("@/lib/keys");
    await getCache().set(keys.ytSearches(), 60, 3600);
    const res = await GET(new Request("http://localhost/api/status"));
    expect(StatusResponse.parse(await res.json()).budget).toBe("exhausted");
  });
});

describe("GET /api/status visitor", () => {
  it("reports the remaining searches for the calling ip", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("VISITOR_SEARCH_LIMIT", "");
    resetCache();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { getCache } = await import("@/lib/cache");
    const { keys } = await import("@/lib/keys");
    const { visitorId } = await import("@/lib/rate-limit");
    const request = new Request("http://localhost/api/status", {
      headers: { "x-forwarded-for": "203.0.113.5" },
    });
    await getCache().set(keys.rlSearch(visitorId(request)), 2, 3600);
    const body = StatusResponse.parse(await (await GET(request)).json());
    expect(body.visitor).toEqual({ remaining: 1, limit: 3, bypass: false });
    const other = StatusResponse.parse(
      await (await GET(new Request("http://localhost/api/status"))).json(),
    );
    expect(other.visitor.remaining).toBe(3);
  });
});

describe("GET /api/status with the passcode cookie", () => {
  it("reports bypass and judges the budget against the total threshold", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("DEMO_PASSCODE", "open-sesame");
    vi.stubEnv("RATE_LIMIT_SALT", "salt");
    vi.stubEnv("YT_PUBLIC_SEARCH_BUDGET", "");
    resetCache();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { passcodeToken } = await import("@/lib/access");
    const { getCache } = await import("@/lib/cache");
    const { keys } = await import("@/lib/keys");
    await getCache().set(keys.ytSearches(), 60, 3600);
    const headers = {
      cookie: `cm_pass=${passcodeToken("open-sesame", "salt")}`,
    };
    const body = StatusResponse.parse(
      await (
        await GET(new Request("http://localhost/api/status", { headers }))
      ).json(),
    );
    expect(body.visitor.bypass).toBe(true);
    expect(body.budget).toBe("ok");
    const plain = StatusResponse.parse(
      await (await GET(new Request("http://localhost/api/status"))).json(),
    );
    expect(plain.visitor.bypass).toBe(false);
    expect(plain.budget).toBe("exhausted");
  });
});
