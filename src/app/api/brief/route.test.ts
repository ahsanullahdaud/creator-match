import { beforeEach, describe, expect, it, vi } from "vitest";

const gemini = vi.hoisted(() => ({
  create: vi.fn(),
  constructed: [] as unknown[],
}));

vi.mock("@google/genai", async () => {
  const { geminiModuleMock } = await import("@/test/mocks");
  return geminiModuleMock(gemini);
});

import { ApiError } from "@google/genai";
import { POST } from "@/app/api/brief/route";
import { getCache, resetCache } from "@/lib/cache";
import { keys } from "@/lib/keys";
import { resetLlm } from "@/lib/llm";
import { BriefResponse, ErrorResponse } from "@/lib/schemas";
import { briefFixture, queryPlanFixture } from "@/test/fixtures";
import { interactionWith } from "@/test/mocks";

function post(body: unknown, raw = false) {
  return POST(
    new Request("http://localhost/api/brief", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.5",
      },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );
}

const validText = JSON.stringify(queryPlanFixture);
type Params = Record<string, unknown>;

describe("POST /api/brief", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("LLM_DAILY_REQUEST_BUDGET", "");
    resetCache();
    resetLlm();
    gemini.create.mockReset();
    gemini.constructed.length = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns a query plan, counts one LLM request, and sends the right Gemini call", async () => {
    gemini.create.mockResolvedValueOnce(interactionWith(validText));

    const res = await post(briefFixture);

    expect(res.status).toBe(200);
    const body = BriefResponse.parse(await res.json());
    expect(body.briefId).toMatch(/^[0-9a-f]{16}$/);
    expect(body.cached).toBe(false);
    expect(body.queries.queries).toHaveLength(3);
    expect(gemini.create).toHaveBeenCalledTimes(1);
    expect(await getCache().get(keys.llmRequests())).toBe(1);

    const [params, options] = gemini.create.mock.calls[0] as [Params, Params];
    expect(params.model).toBe("gemini-3.5-flash-lite");
    expect(params.system_instruction).toMatch(/YouTube search queries/);
    expect(params.input).toMatch(/Peak Fuel/);
    expect(params.response_format).toMatchObject({
      type: "text",
      mime_type: "application/json",
    });
    const schema = (params.response_format as { schema: Params }).schema;
    expect(schema.type).toBe("object");
    expect(schema.$schema).toBeUndefined();
    expect(params.generation_config).toMatchObject({
      thinking_level: "low",
      max_output_tokens: 1024,
    });
    expect(options.timeout).toBe(30_000);
    expect(options.retries).toMatchObject({ maxRetries: 2 });
    expect(gemini.constructed[0]).toEqual({ apiKey: "test-key" });
  });

  it("serves the second identical brief from cache without an LLM call", async () => {
    gemini.create.mockResolvedValueOnce(interactionWith(validText));
    await post(briefFixture);
    const res = await post({ ...briefFixture, brandName: "  peak FUEL labs " });
    const body = BriefResponse.parse(await res.json());
    expect(body.cached).toBe(true);
    expect(body.queries).toEqual(queryPlanFixture);
    expect(gemini.create).toHaveBeenCalledTimes(1);
    expect(await getCache().get(keys.llmRequests())).toBe(1);
  });

  it("rejects an invalid brief and a non-JSON body with 400", async () => {
    const bad = await post({ brandName: "X" });
    expect(bad.status).toBe(400);
    expect(ErrorResponse.parse(await bad.json()).error.code).toBe(
      "invalid_request",
    );
    const notJson = await post("brandName=X", true);
    expect(notJson.status).toBe(400);
    expect(gemini.create).not.toHaveBeenCalled();
  });

  it("maps an empty or blocked answer to a non-retryable llm_error", async () => {
    gemini.create.mockResolvedValueOnce(interactionWith("", "completed"));
    const res = await post(briefFixture);
    expect(res.status).toBe(502);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.code).toBe("llm_error");
    expect(body.error.retryable).toBeUndefined();
    expect(gemini.create).toHaveBeenCalledTimes(1);
  });

  it("re-asks once when the first answer is not valid JSON", async () => {
    const fenced = "```json\n" + validText + "\n```";
    gemini.create
      .mockResolvedValueOnce(interactionWith("Sure! Here are some queries..."))
      .mockResolvedValueOnce(interactionWith(fenced));
    const res = await post(briefFixture);
    expect(res.status).toBe(200);
    expect(gemini.create).toHaveBeenCalledTimes(2);
    const second = gemini.create.mock.calls[1][0] as { input: string };
    expect(second.input).toMatch(/only the JSON object/);
    expect(await getCache().get(keys.llmRequests())).toBe(2);
  });

  it("gives up after a second invalid answer", async () => {
    gemini.create
      .mockResolvedValueOnce(interactionWith("nope"))
      .mockResolvedValueOnce(interactionWith('{"queries": "wrong shape"}'));
    const res = await post(briefFixture);
    expect(res.status).toBe(502);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.code).toBe("llm_error");
    expect(body.error.retryable).toBeUndefined();
  });

  it("maps a 429 from Gemini to a retryable llm_error", async () => {
    gemini.create.mockRejectedValueOnce(
      new ApiError({ message: "RESOURCE_EXHAUSTED", status: 429 }),
    );
    const res = await post(briefFixture);
    expect(res.status).toBe(502);
    const body = ErrorResponse.parse(await res.json());
    expect(body.error.code).toBe("llm_error");
    expect(body.error.retryable).toBe(true);
    expect(body.error.message).toMatch(/rate limit/i);
  });

  it("fails closed with budget_exhausted once the daily LLM budget is spent", async () => {
    vi.stubEnv("LLM_DAILY_REQUEST_BUDGET", "3");
    await getCache().set(keys.llmRequests(), 3, 3600);
    const res = await post(briefFixture);
    expect(res.status).toBe(503);
    expect(ErrorResponse.parse(await res.json()).error.code).toBe(
      "budget_exhausted",
    );
    expect(gemini.create).not.toHaveBeenCalled();
  });

  it("keeps at most 3 queries", async () => {
    const five = {
      ...queryPlanFixture,
      queries: [
        ...queryPlanFixture.queries,
        { q: "running shoes review", intent: "extra" },
        { q: "race day nutrition", intent: "extra" },
      ],
    };
    gemini.create.mockResolvedValueOnce(interactionWith(JSON.stringify(five)));
    const res = await post(briefFixture);
    const body = BriefResponse.parse(await res.json());
    expect(body.queries.queries).toHaveLength(3);
  });

  it("returns 500 internal when the API key is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    resetLlm();
    const res = await post(briefFixture);
    expect(res.status).toBe(500);
    expect(gemini.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/brief visitor limit", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("VISITOR_BRIEF_LIMIT", "");
    resetCache();
    resetLlm();
    gemini.create.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("refuses a visitor past VISITOR_BRIEF_LIMIT before any model call", async () => {
    vi.stubEnv("VISITOR_BRIEF_LIMIT", "1");
    gemini.create.mockResolvedValue(interactionWith(validText));
    expect((await post(briefFixture)).status).toBe(200);
    const second = await post({ ...briefFixture, brandName: "Other Brand" });
    expect(second.status).toBe(429);
    expect(ErrorResponse.parse(await second.json()).error.code).toBe(
      "visitor_limit",
    );
    expect(gemini.create).toHaveBeenCalledTimes(1);
  });

  it("does not count a cached brief", async () => {
    vi.stubEnv("VISITOR_BRIEF_LIMIT", "1");
    gemini.create.mockResolvedValue(interactionWith(validText));
    await post(briefFixture);
    const cached = await post(briefFixture);
    expect(BriefResponse.parse(await cached.json()).cached).toBe(true);
    const { visitorId } = await import("@/lib/rate-limit");
    const visitor = visitorId(
      new Request("http://x", {
        headers: { "x-forwarded-for": "203.0.113.5" },
      }),
    );
    expect(await getCache().get(keys.rlBrief(visitor))).toBe(1);
  });
});

describe("POST /api/brief with the passcode cookie", () => {
  it("ignores the brief limit", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("VISITOR_BRIEF_LIMIT", "1");
    vi.stubEnv("DEMO_PASSCODE", "open-sesame");
    vi.stubEnv("RATE_LIMIT_SALT", "salt");
    resetCache();
    resetLlm();
    gemini.create.mockReset();
    gemini.create.mockResolvedValue(interactionWith(validText));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { passcodeToken } = await import("@/lib/access");
    const headers = {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.5",
      cookie: `cm_pass=${passcodeToken("open-sesame", "salt")}`,
    };
    const send = (body: unknown) =>
      POST(
        new Request("http://localhost/api/brief", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      );
    expect((await send(briefFixture)).status).toBe(200);
    expect((await send({ ...briefFixture, brandName: "Second" })).status).toBe(
      200,
    );
    expect((await send({ ...briefFixture, brandName: "Third" })).status).toBe(
      200,
    );
  });
});
