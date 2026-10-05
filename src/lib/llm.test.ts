import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resetCache } from "@/lib/cache";
import {
  completeJson,
  generateQueries,
  mapLlmError,
  resetLlm,
  setProvider,
  toJsonSchema,
} from "@/lib/llm";
import {
  LlmError,
  type LlmProvider,
  type StructuredRequest,
} from "@/lib/llm/provider";
import { CreatorScoreBatch, QueryPlan } from "@/lib/schemas";
import { briefFixture, queryPlanFixture } from "@/test/fixtures";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeProvider(
  complete: (request: StructuredRequest) => Promise<string>,
): LlmProvider {
  return { name: "fake", complete: async (r) => ({ text: await complete(r) }) };
}

describe("toJsonSchema", () => {
  it("drops $schema and keeps required fields and descriptions", () => {
    const json = toJsonSchema(QueryPlan);
    expect(json.$schema).toBeUndefined();
    expect(json.type).toBe("object");
    expect(json.required).toEqual(
      expect.arrayContaining(["queries", "contentThemes", "avoid"]),
    );
    const queries = (
      json.properties as Record<string, { description?: string }>
    ).queries;
    expect(queries.description).toMatch(/Exactly 3 queries/);
  });

  it("works for the batch score schema", () => {
    const json = toJsonSchema(CreatorScoreBatch);
    const scores = (
      json.properties as Record<string, { items: { required: string[] } }>
    ).scores;
    expect(scores.items.required).toEqual(
      expect.arrayContaining(["channelId", "fitScore"]),
    );
  });
});

describe("mapLlmError", () => {
  it("keeps AppError, maps LlmError, and treats unknowns as retryable", () => {
    const rate = mapLlmError(new LlmError("rate_limit", "429"), "x");
    expect(rate).toMatchObject({
      code: "llm_error",
      retryable: true,
      status: 502,
    });
    const blocked = mapLlmError(new LlmError("blocked", "no text"), "x");
    expect(blocked.retryable).toBe(false);
    expect(mapLlmError(new Error("?"), "x").retryable).toBe(true);
    expect(mapLlmError(rate, "y")).toBe(rate);
  });
});

describe("completeJson", () => {
  beforeEach(() => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("LLM_CONCURRENCY", "2");
    resetCache();
    resetLlm();
  });

  it("never runs more provider calls at once than LLM_CONCURRENCY", async () => {
    let active = 0;
    let peak = 0;
    setProvider(
      fakeProvider(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await tick(5);
        active -= 1;
        return JSON.stringify({ n: 1 });
      }),
    );
    const schema = z.object({ n: z.number() });
    const call = () =>
      completeJson(schema, {
        model: "m",
        system: "s",
        prompt: "p",
        maxOutputTokens: 10,
        label: "t",
      });
    const results = await Promise.all([call(), call(), call(), call(), call()]);
    expect(results).toHaveLength(5);
    expect(peak).toBe(2);
  });

  it("generateQueries drops blank queries and truncates to three", async () => {
    setProvider(
      fakeProvider(async () =>
        JSON.stringify({
          ...queryPlanFixture,
          queries: [
            { q: "   ", intent: "blank" },
            ...queryPlanFixture.queries,
            { q: "fourth query here", intent: "extra" },
          ],
        }),
      ),
    );
    const plan = await generateQueries(briefFixture);
    expect(plan.queries.map((q) => q.q)).toEqual(
      queryPlanFixture.queries.map((q) => q.q),
    );
  });

  it("generateQueries fails when every query is blank", async () => {
    setProvider(
      fakeProvider(async () =>
        JSON.stringify({
          ...queryPlanFixture,
          queries: [{ q: "", intent: "" }],
        }),
      ),
    );
    await expect(generateQueries(briefFixture)).rejects.toMatchObject({
      code: "llm_error",
      retryable: true,
    });
  });
});
