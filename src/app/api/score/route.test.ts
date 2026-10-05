import { beforeEach, describe, expect, it, vi } from "vitest";

const gemini = vi.hoisted(() => ({
  create: vi.fn(),
  constructed: [] as unknown[],
}));

vi.mock("@google/genai", async () => {
  const { geminiModuleMock } = await import("@/test/mocks");
  return geminiModuleMock(gemini);
});

import { POST } from "@/app/api/score/route";
import { getCache, resetCache } from "@/lib/cache";
import { keys } from "@/lib/keys";
import { resetLlm } from "@/lib/llm";
import { ErrorResponse, type ScoreRecord } from "@/lib/schemas";
import {
  CHANNEL_IDS,
  readLines,
  scoreInteraction,
  scoreRequest,
  seedBriefAndSearch,
} from "@/test/score-helpers";

describe("POST /api/score", () => {
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

  it("scores 10 channels in exactly 2 requests and streams one line each plus done", async () => {
    const id = await seedBriefAndSearch();
    gemini.create.mockImplementation(async (params: unknown) =>
      scoreInteraction(params),
    );

    const res = await POST(scoreRequest(id, CHANNEL_IDS));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = await readLines(res);

    const scores = lines.filter((l) => l.type === "score");
    expect(scores).toHaveLength(10);
    expect(scores.every((l) => l.type === "score" && l.cached === false)).toBe(
      true,
    );
    expect(lines.at(-1)).toEqual({ type: "done", scored: 10, failed: 0 });
    expect(gemini.create).toHaveBeenCalledTimes(2);
    expect(await getCache().get(keys.scoreCount(id))).toBe(10);
    expect(await getCache().get(keys.llmRequests())).toBe(2);
    const record = await getCache().get<ScoreRecord>(keys.score(id, "UC0"));
    expect(record?.model).toBe("gemini-3.5-flash-lite");
    expect(record?.score.verdict).toBe("strong");
    const [params] = gemini.create.mock.calls[0] as [
      { system_instruction: string; input: string },
    ];
    expect(params.system_instruction).toMatch(/fitScore 0 to 100/);
    expect(params.input).toMatch(/Channels to score \(5\)/);
  });

  it("serves cached scores without any model call", async () => {
    const id = await seedBriefAndSearch();
    gemini.create.mockImplementation(async (params: unknown) =>
      scoreInteraction(params),
    );
    await readLines(await POST(scoreRequest(id, CHANNEL_IDS)));
    const lines = await readLines(
      await POST(scoreRequest(id, CHANNEL_IDS.slice(0, 3))),
    );
    expect(lines.filter((l) => l.type === "score" && l.cached)).toHaveLength(3);
    expect(lines.at(-1)).toEqual({ type: "done", scored: 3, failed: 0 });
    expect(gemini.create).toHaveBeenCalledTimes(2);
  });

  it("emits score_cap lines once the cap is reached", async () => {
    const id = await seedBriefAndSearch();
    await getCache().set(keys.scoreCount(id), 10, 3600);
    const lines = await readLines(
      await POST(scoreRequest(id, CHANNEL_IDS.slice(0, 2))),
    );
    expect(
      lines.filter((l) => l.type === "error" && l.code === "score_cap"),
    ).toHaveLength(2);
    expect(lines.at(-1)).toEqual({ type: "done", scored: 0, failed: 2 });
    expect(gemini.create).not.toHaveBeenCalled();
  });

  it("rejects unknown briefs, missing searches, and foreign channel ids", async () => {
    const unknown = await POST(scoreRequest("0123456789abcdef", ["UC0"]));
    expect(unknown.status).toBe(404);
    const id = await seedBriefAndSearch();
    await getCache().del(keys.search(id));
    const noSearch = await POST(scoreRequest(id, ["UC0"]));
    expect(noSearch.status).toBe(404);
    await seedBriefAndSearch();
    const foreign = await POST(scoreRequest(id, ["nope"]));
    expect(foreign.status).toBe(400);
    expect(ErrorResponse.parse(await foreign.json()).error.code).toBe(
      "invalid_request",
    );
    expect(gemini.create).not.toHaveBeenCalled();
  });
});
