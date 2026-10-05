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
import { POST as postPasscode } from "@/app/api/passcode/route";
import { POST as postScore } from "@/app/api/score/route";
import { POST as postSearch } from "@/app/api/search/route";
import { GET as getStatus } from "@/app/api/status/route";
import { resetCache, setCache } from "@/lib/cache";
import { CACHE_DOWN_MESSAGE } from "@/lib/errors";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";
import { briefId } from "@/lib/hash";
import { keys } from "@/lib/keys";
import { resetLlm } from "@/lib/llm";
import {
  BriefResponse,
  ErrorResponse,
  SearchResponse,
  StatusResponse,
  type ScoreLine,
} from "@/lib/schemas";
import { searchVideos } from "@/lib/youtube";
import { briefFixture, queryPlanFixture } from "@/test/fixtures";
import { FailingStore } from "@/test/mocks";
import { CHANNEL_IDS, creatorsFixture } from "@/test/score-helpers";

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

async function errorOf(res: Response) {
  return ErrorResponse.parse(await res.json()).error;
}

describe("with Redis down", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("DEMO_PASSCODE", "open-sesame");
    vi.stubEnv("RATE_LIMIT_SALT", "salt");
    resetCache();
    resetLlm();
    setCache(new FailingStore());
    gemini.create.mockReset();
    vi.mocked(searchVideos).mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("a live brief refuses with budget_exhausted and never calls Gemini", async () => {
    const res = await post(postBrief, "/api/brief", briefFixture);
    expect(res.status).toBe(503);
    expect(await errorOf(res)).toEqual({
      code: "budget_exhausted",
      message: CACHE_DOWN_MESSAGE,
      retryable: true,
    });
    expect(gemini.create).not.toHaveBeenCalled();
  });

  it("a live search refuses with budget_exhausted and never calls YouTube", async () => {
    const id = briefId(briefFixture);
    setCache(
      new FailingStore({
        [keys.brief(id)]: {
          briefId: id,
          brief: briefFixture,
          queries: queryPlanFixture,
          createdAt: "x",
        },
      }),
    );
    const res = await post(postSearch, "/api/search", { briefId: id });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe("budget_exhausted");
    expect(searchVideos).not.toHaveBeenCalled();
  });

  it("a live score stream turns the outage into budget_exhausted lines and still ends with done", async () => {
    const id = briefId(briefFixture);
    setCache(
      new FailingStore({
        [keys.brief(id)]: {
          briefId: id,
          brief: briefFixture,
          queries: queryPlanFixture,
          createdAt: "x",
        },
        [keys.search(id)]: {
          briefId: id,
          creators: creatorsFixture(),
          liveSearches: 3,
          createdAt: "x",
        },
      }),
    );
    const res = await post(postScore, "/api/score", {
      briefId: id,
      channelIds: CHANNEL_IDS,
    });
    expect(res.status).toBe(200);
    const lines = (await res.text())
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ScoreLine);
    const errors = lines.filter((l) => l.type === "error");
    expect(errors).toHaveLength(10);
    expect(
      errors.every(
        (l) =>
          l.type === "error" && l.code === "budget_exhausted" && l.retryable,
      ),
    ).toBe(true);
    expect(lines.at(-1)).toEqual({ type: "done", scored: 0, failed: 10 });
    expect(gemini.create).not.toHaveBeenCalled();
  });

  it("the precomputed examples keep working end to end", async () => {
    const example = EXAMPLE_BRIEFS[2];
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
    expect(search.budget).toBe("unavailable");
    expect(search.visitor.remaining).toBe(0);
    const res = await post(postScore, "/api/score", {
      briefId: brief.briefId,
      channelIds: search.creators.map((c) => c.channelId),
    });
    const lines = (await res.text())
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ScoreLine);
    expect(lines.filter((l) => l.type === "score" && l.cached)).toHaveLength(
      search.creators.length,
    );
    expect(lines.at(-1)).toMatchObject({ type: "done", failed: 0 });
    expect(gemini.create).not.toHaveBeenCalled();
    expect(searchVideos).not.toHaveBeenCalled();
  });

  it("status reports unavailable but still lists the examples", async () => {
    const res = await getStatus(new Request("http://localhost/api/status"));
    expect(res.status).toBe(200);
    const body = StatusResponse.parse(await res.json());
    expect(body.budget).toBe("unavailable");
    expect(body.visitor).toEqual({ remaining: 0, limit: 3, bypass: false });
    expect(body.examples).toHaveLength(3);
  });

  it("the passcode route fails closed too", async () => {
    const res = await post(postPasscode, "/api/passcode", {
      passcode: "open-sesame",
    });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe("budget_exhausted");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
