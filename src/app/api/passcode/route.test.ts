import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, POST } from "@/app/api/passcode/route";
import { passcodeToken } from "@/lib/access";
import { getCache, resetCache } from "@/lib/cache";
import { keys } from "@/lib/keys";
import { visitorId } from "@/lib/rate-limit";
import { ErrorResponse, PasscodeResponse } from "@/lib/schemas";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://example.com/api/passcode", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.5",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("/api/passcode", () => {
  beforeEach(() => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("DEMO_PASSCODE", "open-sesame");
    vi.stubEnv("RATE_LIMIT_SALT", "salt");
    resetCache();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("sets the bypass cookie for the right passcode", async () => {
    const res = await post({ passcode: "open-sesame" });
    expect(res.status).toBe(200);
    expect(PasscodeResponse.parse(await res.json())).toEqual({ bypass: true });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`cm_pass=${passcodeToken("open-sesame", "salt")}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("open-sesame");
  });

  it("refuses a wrong passcode, a missing passcode, and an unconfigured deployment", async () => {
    const wrong = await post({ passcode: "nope" });
    expect(wrong.status).toBe(403);
    expect(ErrorResponse.parse(await wrong.json()).error.code).toBe(
      "forbidden",
    );
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect((await post({})).status).toBe(400);
    vi.stubEnv("DEMO_PASSCODE", "");
    const unset = await post({ passcode: "open-sesame" });
    expect(unset.status).toBe(403);
  });

  it("caps attempts per visitor per day", async () => {
    const visitor = visitorId(
      new Request("http://x", {
        headers: { "x-forwarded-for": "203.0.113.5" },
      }),
    );
    await getCache().set(keys.rlPasscode(visitor), 20, 3600);
    const res = await post({ passcode: "open-sesame" });
    expect(res.status).toBe(429);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe(
      "visitor_limit",
    );
    const other = await post(
      { passcode: "open-sesame" },
      { "x-forwarded-for": "198.51.100.7" },
    );
    expect(other.status).toBe(200);
  });

  it("DELETE clears the cookie", async () => {
    const res = await DELETE(
      new Request("https://example.com/api/passcode", { method: "DELETE" }),
    );
    expect(PasscodeResponse.parse(await res.json())).toEqual({ bypass: false });
    expect(res.headers.get("set-cookie")).toContain(
      "cm_pass=; Path=/; Max-Age=0",
    );
  });
});
