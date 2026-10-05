import { beforeEach, describe, expect, it, vi } from "vitest";

const gemini = vi.hoisted(() => ({
  create: vi.fn(),
  constructed: [] as unknown[],
}));
vi.mock("@google/genai", async () => {
  const { geminiModuleMock } = await import("@/test/mocks");
  return geminiModuleMock(gemini);
});
vi.mock("@/lib/youtube", () => ({
  searchVideos: vi.fn(),
  getChannels: vi.fn(),
}));

import { POST as postBrief } from "@/app/api/brief/route";
import { POST as postScore } from "@/app/api/score/route";
import { POST as postSearch } from "@/app/api/search/route";
import { GET as getStatus } from "@/app/api/status/route";
import { getCache, resetCache } from "@/lib/cache";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";
import { exampleLookup, listExamples } from "@/lib/examples";
import { briefId } from "@/lib/hash";
import { keys } from "@/lib/keys";
import { resetLlm } from "@/lib/llm";
import {
  BriefResponse,
  SearchResponse,
  StatusResponse,
  type BriefRecord,
  type ScoreLine,
} from "@/lib/schemas";
import { searchVideos } from "@/lib/youtube";

function post(
  handler: (r: Request) => Promise<Response>,
  path: string,
  body: unknown,
) {
  return handler(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.5",
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("precomputed examples", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    // Every budget at zero: the examples must still work.
    vi.stubEnv("VISITOR_SEARCH_LIMIT", "0");
    vi.stubEnv("YT_PUBLIC_SEARCH_BUDGET", "0");
    vi.stubEnv("YT_TOTAL_SEARCH_BUDGET", "0");
    vi.stubEnv("LLM_DAILY_REQUEST_BUDGET", "0");
    resetCache();
    resetLlm();
    gemini.create.mockReset();
    vi.mocked(searchVideos).mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("match the example briefs one to one and are internally consistent", () => {
    const list = listExamples();
    expect(list.map((e) => e.slug)).toEqual(EXAMPLE_BRIEFS.map((e) => e.slug));
    for (const [i, example] of EXAMPLE_BRIEFS.entries()) {
      const id = briefId(example.brief);
      expect(list[i].brief).toEqual(example.brief);
      const brief = exampleLookup<BriefRecord>(keys.brief(id));
      expect(brief?.briefId).toBe(id);
      expect(brief?.queries.queries.length).toBeGreaterThan(0);
      const search = exampleLookup<{ creators: { channelId: string }[] }>(
        keys.search(id),
      );
      expect(search?.creators.length).toBeGreaterThan(0);
      expect(search?.creators.length).toBeLessThanOrEqual(10);
      for (const creator of search?.creators ?? []) {
        expect(exampleLookup(keys.score(id, creator.channelId))).toBeDefined();
      }
    }
    expect(exampleLookup(keys.brief("0000000000000000"))).toBeUndefined();
  });

  it("are served through the cache without any write", async () => {
    const id = briefId(EXAMPLE_BRIEFS[0].brief);
    expect(await getCache().get<BriefRecord>(keys.brief(id))).toMatchObject({
      briefId: id,
    });
    expect(await getCache().get(keys.search(id))).toBeDefined();
    await getCache().set("other", 1, 60);
    expect(await getCache().get("other")).toBe(1);
  });

  it("run the full pipeline with every budget at zero and no external calls", async () => {
    const example = EXAMPLE_BRIEFS[1];
    const brief = BriefResponse.parse(
      await (await post(postBrief, "/api/brief", example.brief)).json(),
    );
    expect(brief.cached).toBe(true);
    const search = SearchResponse.parse(
      await (
        await post(postSearch, "/api/search", { briefId: brief.briefId })
      ).json(),
    );
    expect(search.cached).toBe(true);
    expect(search.creators.length).toBeGreaterThan(0);
    const scoreRes = await post(postScore, "/api/score", {
      briefId: brief.briefId,
      channelIds: search.creators.map((c) => c.channelId),
    });
    const lines = (await scoreRes.text())
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ScoreLine);
    const scores = lines.filter((l) => l.type === "score");
    expect(scores).toHaveLength(search.creators.length);
    expect(scores.every((l) => l.type === "score" && l.cached)).toBe(true);
    expect(lines.at(-1)).toMatchObject({ type: "done", failed: 0 });
    expect(gemini.create).not.toHaveBeenCalled();
    expect(searchVideos).not.toHaveBeenCalled();
    expect(await getCache().get(keys.llmRequests())).toBeNull();
    expect(await getCache().get(keys.ytSearches())).toBeNull();
  });

  it("are listed by the status route", async () => {
    const body = StatusResponse.parse(
      await (
        await getStatus(new Request("http://localhost/api/status"))
      ).json(),
    );
    expect(body.examples.map((e) => e.slug)).toEqual(
      EXAMPLE_BRIEFS.map((e) => e.slug),
    );
    expect(body.examples[0].brief.brandName).toBe("Peak Fuel");
  });
});
