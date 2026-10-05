import { getCache } from "@/lib/cache";
import { getConfig, LIMITS, TTL_SECONDS } from "@/lib/config";
import { AppError, fromZodError } from "@/lib/errors";
import { keys } from "@/lib/keys";
import { aggregateHits, pickCandidates, selectCreators } from "@/lib/pipeline";
import { budgetState, youtubeSearchesToday } from "@/lib/rate-limit";
import { handle, json, readJson } from "@/lib/route";
import {
  SearchRequest,
  type BriefRecord,
  type SearchRecord,
  type SearchResponse,
  type VisitorStatus,
} from "@/lib/schemas";
import { getChannels, searchVideos, type SearchResult } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONE_DAY = 24 * 3600;

export const POST = handle("search", async (request, ctx) => {
  const parsed = SearchRequest.safeParse(await readJson(request));
  if (!parsed.success) throw fromZodError(parsed.error);
  const { briefId } = parsed.data;
  ctx.log.briefId = briefId;

  const cache = getCache();
  const config = getConfig();
  const briefRecord = await cache.get<BriefRecord>(keys.brief(briefId));
  if (!briefRecord) {
    throw new AppError("not_found", "Unknown brief. Submit the brief again.");
  }

  // Visitor counters arrive in step 9; until then everyone sees the full allowance.
  const visitor: VisitorStatus = {
    remaining: config.VISITOR_SEARCH_LIMIT,
    limit: config.VISITOR_SEARCH_LIMIT,
    bypass: false,
  };
  const respond = async (record: SearchRecord, cached: boolean) => {
    const body: SearchResponse = {
      briefId,
      creators: record.creators,
      cached,
      visitor,
      budget: budgetState(await youtubeSearchesToday(cache), config),
    };
    return json(body);
  };

  const existing = await cache.get<SearchRecord>(keys.search(briefId));
  if (existing) {
    ctx.log.cached = true;
    return respond(existing, true);
  }

  const { brief, queries } = briefRecord;
  const plan = queries.queries.slice(0, LIMITS.MAX_QUERIES);

  const searchStart = Date.now();
  const settled = await Promise.allSettled(
    plan.map((query) => searchVideos(query.q, brief.region, brief.language)),
  );
  const results: SearchResult[] = [];
  let firstFailure: unknown = null;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") results.push(outcome.value);
    else if (firstFailure === null) firstFailure = outcome.reason;
  }
  if (results.length === 0) {
    throw firstFailure instanceof Error
      ? firstFailure
      : new AppError("youtube_error", "YouTube search failed", {
          retryable: true,
        });
  }
  const liveSearches = results.filter((r) => r.live).length;
  ctx.log.search_ms = Date.now() - searchStart;
  ctx.log.live_searches = liveSearches;
  ctx.log.failed_queries = settled.length - results.length;

  const candidates = pickCandidates(aggregateHits(results.map((r) => r.hits)));
  const channelStart = Date.now();
  const channels = await getChannels(candidates.map((c) => c.channelId));
  ctx.log.channels_ms = Date.now() - channelStart;
  ctx.log.candidates = candidates.length;

  const creators = selectCreators(channels, candidates, brief);
  ctx.log.creators = creators.length;

  const record: SearchRecord = {
    briefId,
    creators,
    liveSearches,
    createdAt: new Date().toISOString(),
  };
  // An empty result is cached too, but only for a day in case the range was the problem.
  await cache.set(
    keys.search(briefId),
    record,
    creators.length > 0 ? TTL_SECONDS.search : ONE_DAY,
  );
  return respond(record, false);
});
