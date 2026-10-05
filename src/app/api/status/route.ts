import { hasBypass } from "@/lib/access";
import { getCache } from "@/lib/cache";
import { LIMITS, getConfig } from "@/lib/config";
import { isCacheUnavailable } from "@/lib/errors";
import { listExamples } from "@/lib/examples";
import {
  budgetState,
  visitorId,
  visitorSearchStatus,
  youtubeSearchesToday,
} from "@/lib/rate-limit";
import { handle, json } from "@/lib/route";
import type { BudgetState, StatusResponse, VisitorStatus } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle("status", async (request, ctx) => {
  const config = getConfig();
  const cache = getCache();
  const visitor = visitorId(request, config);
  const bypass = hasBypass(request, config);
  ctx.log.visitor = visitor;
  ctx.log.bypass = bypass;

  // Real round trips, so bad Redis credentials show up here and not in /api/search.
  // When Redis is down the page must still load: report "unavailable" instead.
  const started = Date.now();
  let visitorStatus: VisitorStatus;
  let budget: BudgetState;
  try {
    const searchesUsed = await youtubeSearchesToday(cache);
    visitorStatus = await visitorSearchStatus({
      cache,
      config,
      visitor,
      bypass,
    });
    budget = budgetState(searchesUsed, config, bypass);
    ctx.log.searches_today = searchesUsed;
  } catch (error) {
    if (!isCacheUnavailable(error)) throw error;
    ctx.log.cache_down = true;
    visitorStatus = {
      remaining: 0,
      limit: config.VISITOR_SEARCH_LIMIT,
      bypass,
    };
    budget = "unavailable";
  }
  ctx.log.cache_ms = Date.now() - started;

  const body: StatusResponse = {
    visitor: visitorStatus,
    budget,
    maxCreators: LIMITS.MAX_CREATORS,
    store: cache.kind,
    examples: listExamples().map(({ slug, title, blurb, brief }) => ({
      slug,
      title,
      blurb,
      brief,
    })),
  };
  return json(body);
});
