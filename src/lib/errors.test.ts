import { describe, expect, it, vi } from "vitest";
import {
  AppError,
  ERROR_STATUS,
  fromZodError,
  isAppError,
  toErrorResponse,
} from "@/lib/errors";
import { Brief, ErrorResponse } from "@/lib/schemas";

describe("AppError", () => {
  it("maps every code to a status", () => {
    expect(new AppError("invalid_request", "x").status).toBe(400);
    expect(new AppError("not_found", "x").status).toBe(404);
    expect(new AppError("visitor_limit", "x").status).toBe(429);
    expect(new AppError("budget_exhausted", "x").status).toBe(503);
    expect(new AppError("score_cap", "x").status).toBe(429);
    expect(new AppError("youtube_error", "x").status).toBe(502);
    expect(new AppError("claude_error", "x").status).toBe(502);
    expect(new AppError("forbidden", "x").status).toBe(403);
    expect(new AppError("internal", "x").status).toBe(500);
    expect(Object.keys(ERROR_STATUS)).toHaveLength(9);
  });

  it("carries retryable, cause and an overridden status", () => {
    const cause = new Error("429 from upstream");
    const error = new AppError("claude_error", "Rate limited", {
      retryable: true,
      cause,
    });
    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(cause);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(new Error("plain"))).toBe(false);
    expect(new AppError("internal", "teapot", { status: 418 }).status).toBe(
      418,
    );
  });
});

describe("toErrorResponse", () => {
  it("serializes an AppError as JSON with its status", async () => {
    const res = toErrorResponse(new AppError("forbidden", "Bad passcode"));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(ErrorResponse.parse(await res.json())).toEqual({
      error: { code: "forbidden", message: "Bad passcode" },
    });
  });

  it("hides unknown errors behind a generic internal error and logs them", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = toErrorResponse(new Error("db exploded"));
    expect(res.status).toBe(500);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.code).toBe("internal");
    expect(body.error.message).not.toContain("exploded");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("fromZodError", () => {
  it("produces a 400 that names the failing fields", () => {
    const result = Brief.safeParse({});
    if (result.success) throw new Error("expected a parse failure");
    const error = fromZodError(result.error);
    expect(error.code).toBe("invalid_request");
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/brandName/);
    expect(error.message).toMatch(/audience/);
  });
});
