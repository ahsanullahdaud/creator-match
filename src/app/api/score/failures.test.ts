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
import { POST } from "@/app/api/score/route";
import { getCache, resetCache } from "@/lib/cache";
import { keys } from "@/lib/keys";
import { resetLlm } from "@/lib/llm";
import { interactionWith } from "@/test/mocks";
import {
  CHANNEL_IDS,
  channelIdsInPrompt,
  readLines,
  scoreInteraction,
  scoreRequest,
  seedBriefAndSearch,
} from "@/test/score-helpers";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("POST /api/score failure paths", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("LLM_DAILY_REQUEST_BUDGET", "");
    vi.stubEnv("LLM_CONCURRENCY", "");
    vi.stubEnv("LLM_SCORE_BATCH_SIZE", "");
    resetCache();
    resetLlm();
    gemini.create.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("never runs more batches at once than LLM_CONCURRENCY", async () => {
    vi.stubEnv("LLM_CONCURRENCY", "1");
    vi.stubEnv("LLM_SCORE_BATCH_SIZE", "2");
    const id = await seedBriefAndSearch();
    let active = 0;
    let peak = 0;
    gemini.create.mockImplementation(async (params: unknown) => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(5);
      active -= 1;
      return scoreInteraction(params);
    });
    const lines = await readLines(await POST(scoreRequest(id, CHANNEL_IDS)));
    expect(gemini.create).toHaveBeenCalledTimes(5);
    expect(peak).toBe(1);
    expect(lines.at(-1)).toEqual({ type: "done", scored: 10, failed: 0 });
  });

  it("turns a safety block into non-retryable error lines for that batch only", async () => {
    const id = await seedBriefAndSearch();
    gemini.create
      .mockResolvedValueOnce(interactionWith("", "completed"))
      .mockImplementationOnce(async (params: unknown) =>
        scoreInteraction(params),
      );
    const lines = await readLines(await POST(scoreRequest(id, CHANNEL_IDS)));
    const errors = lines.filter((l) => l.type === "error");
    expect(errors).toHaveLength(5);
    expect(
      errors.every(
        (l) => l.type === "error" && l.code === "llm_error" && !l.retryable,
      ),
    ).toBe(true);
    expect(lines.filter((l) => l.type === "score")).toHaveLength(5);
    expect(lines.at(-1)).toEqual({ type: "done", scored: 5, failed: 5 });
    expect(await getCache().get(keys.scoreCount(id))).toBe(5);
  });

  it("turns a 429 after retries into retryable error lines", async () => {
    const id = await seedBriefAndSearch();
    gemini.create.mockRejectedValue(
      new ApiError({ message: "RESOURCE_EXHAUSTED", status: 429 }),
    );
    const lines = await readLines(
      await POST(scoreRequest(id, CHANNEL_IDS.slice(0, 5))),
    );
    const errors = lines.filter((l) => l.type === "error");
    expect(errors).toHaveLength(5);
    expect(
      errors.every(
        (l) => l.type === "error" && l.retryable && l.code === "llm_error",
      ),
    ).toBe(true);
    expect(await getCache().get(keys.scoreCount(id))).toBeNull();
  });

  it("gives a skipped channel a single retryable error line and counts only scored ones", async () => {
    const id = await seedBriefAndSearch();
    gemini.create.mockImplementation(async (params: unknown) => {
      const ids = channelIdsInPrompt(params);
      return scoreInteraction(params, [ids[1]]);
    });
    const lines = await readLines(
      await POST(scoreRequest(id, CHANNEL_IDS.slice(0, 5))),
    );
    const errors = lines.filter((l) => l.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      channelId: "UC1",
      code: "llm_error",
      retryable: true,
    });
    expect(lines.filter((l) => l.type === "score")).toHaveLength(4);
    expect(await getCache().get(keys.scoreCount(id))).toBe(4);
    expect(await getCache().get(keys.score(id, "UC1"))).toBeNull();
  });

  it("fails closed with budget_exhausted lines when the daily LLM budget is spent", async () => {
    vi.stubEnv("LLM_DAILY_REQUEST_BUDGET", "2");
    await getCache().set(keys.llmRequests(), 2, 3600);
    const id = await seedBriefAndSearch();
    const lines = await readLines(await POST(scoreRequest(id, CHANNEL_IDS)));
    const errors = lines.filter((l) => l.type === "error");
    expect(errors).toHaveLength(10);
    expect(
      errors.every((l) => l.type === "error" && l.code === "budget_exhausted"),
    ).toBe(true);
    expect(gemini.create).not.toHaveBeenCalled();
  });

  it("still emits done when a batch throws something unexpected", async () => {
    const id = await seedBriefAndSearch();
    gemini.create.mockRejectedValue(new TypeError("boom"));
    const lines = await readLines(
      await POST(scoreRequest(id, CHANNEL_IDS.slice(0, 2))),
    );
    expect(lines.filter((l) => l.type === "error" && l.retryable)).toHaveLength(
      2,
    );
    expect(lines.at(-1)).toEqual({ type: "done", scored: 0, failed: 2 });
  });
});
