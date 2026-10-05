import { getCache } from "@/lib/cache";
import { briefId } from "@/lib/hash";
import { keys } from "@/lib/keys";
import { toCreator } from "@/lib/pipeline";
import type { Creator, ScoreLine } from "@/lib/schemas";
import {
  briefFixture,
  channelInfoFixture,
  creatorScoreFixture,
  queryPlanFixture,
} from "@/test/fixtures";
import { interactionWith } from "@/test/mocks";

export const CHANNEL_IDS = Array.from({ length: 10 }, (_, i) => `UC${i}`);

export function creatorsFixture(ids: string[] = CHANNEL_IDS): Creator[] {
  return ids.map((id, i) =>
    toCreator(channelInfoFixture(id), {
      channelId: id,
      hits: i === 0 ? 2 : 1,
      latest: "2026-09-20T00:00:00Z",
      videos: [
        {
          videoId: `${id}-v`,
          title: `Video ${id}`,
          publishedAt: "2026-09-20T00:00:00Z",
        },
      ],
    }),
  );
}

/** Seeds the brief and search records the score route needs. Returns the brief id. */
export async function seedBriefAndSearch(
  ids: string[] = CHANNEL_IDS,
): Promise<string> {
  const id = briefId(briefFixture);
  const cache = getCache();
  await cache.set(
    keys.brief(id),
    {
      briefId: id,
      brief: briefFixture,
      queries: queryPlanFixture,
      createdAt: "2026-10-05T00:00:00Z",
    },
    3600,
  );
  await cache.set(
    keys.search(id),
    {
      briefId: id,
      creators: creatorsFixture(ids),
      liveSearches: 3,
      createdAt: "2026-10-05T00:00:00Z",
    },
    3600,
  );
  return id;
}

/** Pulls the channelIds out of a scoring prompt, in order. */
export function channelIdsInPrompt(params: unknown): string[] {
  const input = (params as { input?: string }).input ?? "";
  return [...input.matchAll(/"channelId":"([^"]+)"/g)].map((m) => m[1]);
}

/** A completed interaction scoring every channel in the prompt (minus `skip`). */
export function scoreInteraction(params: unknown, skip: string[] = []) {
  const ids = channelIdsInPrompt(params).filter((id) => !skip.includes(id));
  return interactionWith(
    JSON.stringify({
      scores: ids.map((channelId, i) => ({
        channelId,
        ...creatorScoreFixture,
        fitScore: 90 - i, // distinct, so sorting is observable
      })),
    }),
  );
}

export async function readLines(res: Response): Promise<ScoreLine[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as ScoreLine);
}

export function scoreRequest(briefId: string, channelIds: string[]) {
  return new Request("http://localhost/api/score", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.5",
    },
    body: JSON.stringify({ briefId, channelIds }),
  });
}
