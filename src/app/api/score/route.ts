import { getCache } from "@/lib/cache";
import { getConfig, LIMITS, TTL_SECONDS } from "@/lib/config";
import { AppError, fromZodError, isAppError } from "@/lib/errors";
import { keys } from "@/lib/keys";
import { scoreCreators } from "@/lib/llm";
import { ndjsonResponse } from "@/lib/ndjson";
import { handle, readJson } from "@/lib/route";
import {
  ScoreRequest,
  type BriefRecord,
  type Creator,
  type CreatorScore,
  type ScoreLine,
  type ScoreRecord,
  type SearchRecord,
} from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

interface BatchOutcome {
  index: number;
  batch: Creator[];
  scores?: Map<string, CreatorScore>;
  error?: unknown;
}

export const POST = handle("score", async (request, ctx) => {
  const parsed = ScoreRequest.safeParse(await readJson(request));
  if (!parsed.success) throw fromZodError(parsed.error);
  const { briefId, channelIds } = parsed.data;
  ctx.log.briefId = briefId;

  const cache = getCache();
  const config = getConfig();
  const briefRecord = await cache.get<BriefRecord>(keys.brief(briefId));
  if (!briefRecord) {
    throw new AppError("not_found", "Unknown brief. Submit the brief again.");
  }
  const searchRecord = await cache.get<SearchRecord>(keys.search(briefId));
  if (!searchRecord) {
    throw new AppError("not_found", "No search results for this brief yet.");
  }
  const byId = new Map(searchRecord.creators.map((c) => [c.channelId, c]));
  const wanted = [...new Set(channelIds)].filter((id) => byId.has(id));
  if (wanted.length === 0) {
    throw new AppError(
      "invalid_request",
      "None of these channels are in the search results for this brief.",
    );
  }
  ctx.log.requested = wanted.length;
  const { brief, queries } = briefRecord;
  ctx.log.streaming = true;
  const started = Date.now();

  async function* lines(): AsyncGenerator<ScoreLine> {
    let scored = 0;
    let failed = 0;

    // Cached scores go out first, before any model call.
    const pending: Creator[] = [];
    for (const id of wanted) {
      const record = await cache.get<ScoreRecord>(keys.score(briefId, id));
      if (record) {
        scored += 1;
        yield {
          type: "score",
          channelId: id,
          score: record.score,
          cached: true,
        };
      } else {
        pending.push(byId.get(id) as Creator);
      }
    }

    // Hard cap per brief, so a replayed request cannot keep spending.
    const issued = (await cache.get<number>(keys.scoreCount(briefId))) ?? 0;
    const allowance = Math.max(0, LIMITS.MAX_CREATORS - issued);
    for (const creator of pending.slice(allowance)) {
      failed += 1;
      yield {
        type: "error",
        channelId: creator.channelId,
        code: "score_cap",
        message: "This brief has reached its scoring cap.",
        retryable: false,
      };
    }

    // One model request per batch; the semaphore in llm.ts limits concurrency.
    const batches = chunk(
      pending.slice(0, allowance),
      config.LLM_SCORE_BATCH_SIZE,
    );
    const inFlight = new Map<number, Promise<BatchOutcome>>();
    batches.forEach((batch, index) => {
      inFlight.set(
        index,
        scoreCreators(brief, queries, batch).then(
          (scores) => ({ index, batch, scores }),
          (error: unknown) => ({ index, batch, error }),
        ),
      );
    });

    while (inFlight.size > 0) {
      const outcome = await Promise.race(inFlight.values());
      inFlight.delete(outcome.index);
      if (outcome.scores) {
        for (const creator of outcome.batch) {
          const score = outcome.scores.get(creator.channelId);
          if (!score) {
            failed += 1;
            yield {
              type: "error",
              channelId: creator.channelId,
              code: "llm_error",
              message: "The model skipped this channel. Retry to score it.",
              retryable: true,
            };
            continue;
          }
          await cache.incr(keys.scoreCount(briefId), TTL_SECONDS.scoreCount);
          const record: ScoreRecord = {
            briefId,
            channelId: creator.channelId,
            score,
            model: config.LLM_SCORE_MODEL,
            createdAt: new Date().toISOString(),
          };
          await cache.set(
            keys.score(briefId, creator.channelId),
            record,
            TTL_SECONDS.score,
          );
          scored += 1;
          yield {
            type: "score",
            channelId: creator.channelId,
            score,
            cached: false,
          };
        }
      } else {
        if (!isAppError(outcome.error))
          console.error("score batch failed", outcome.error);
        const error = isAppError(outcome.error)
          ? outcome.error
          : new AppError("internal", "Scoring failed unexpectedly.", {
              retryable: true,
            });
        for (const creator of outcome.batch) {
          failed += 1;
          yield {
            type: "error",
            channelId: creator.channelId,
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          };
        }
      }
    }

    console.log(
      JSON.stringify({
        route: "score",
        event: "stream_done",
        briefId,
        ms: Date.now() - started,
        scored,
        failed,
        batches: batches.length,
      }),
    );
    yield { type: "done", scored, failed };
  }

  return ndjsonResponse(lines());
});
