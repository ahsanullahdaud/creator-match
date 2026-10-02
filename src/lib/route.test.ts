import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { handle, json } from "@/lib/route";

describe("json", () => {
  it("sets content-type and no-store by default", async () => {
    const res = json({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("keeps a caller-provided status and cache-control", () => {
    const res = json(
      { ok: false },
      {
        status: 201,
        headers: { "cache-control": "public, max-age=60" },
      },
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  });
});

describe("handle", () => {
  it("maps AppError to its status and logs one line with extra fields", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const route = handle("demo", async (_request, ctx) => {
      ctx.log.stage_ms = 7;
      throw new AppError("visitor_limit", "Daily limit reached");
    });

    const res = await route(
      new Request("http://localhost/api/demo", { method: "POST" }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: { code: "visitor_limit", message: "Daily limit reached" },
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
      route: "demo",
      method: "POST",
      status: 429,
      stage_ms: 7,
    });
  });

  it("turns unknown errors into a 500 without leaking the message", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const route = handle("demo", async () => {
      throw new Error("secret detail");
    });
    const res = await route(new Request("http://localhost/api/demo"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal");
    expect(JSON.stringify(body)).not.toContain("secret detail");
  });
});
