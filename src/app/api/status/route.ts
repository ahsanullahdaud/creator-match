import { getCache } from "@/lib/cache";
import { LIMITS, getConfig } from "@/lib/config";
import { budgetState, youtubeSearchesToday } from "@/lib/rate-limit";
import { handle, json } from "@/lib/route";
import type { StatusResponse } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle("status", async (_request, ctx) => {
  const config = getConfig();
  const cache = getCache();

  // A real round trip, so bad Redis credentials show up here and not in /api/search.
  const started = Date.now();
  const searchesUsed = await youtubeSearchesToday(cache);
  ctx.log.cache_ms = Date.now() - started;
  ctx.log.searches_today = searchesUsed;

  // Visitor counters and examples arrive in later steps.
  const body: StatusResponse = {
    visitor: {
      remaining: config.VISITOR_SEARCH_LIMIT,
      limit: config.VISITOR_SEARCH_LIMIT,
      bypass: false,
    },
    budget: budgetState(searchesUsed, config),
    maxCreators: LIMITS.MAX_CREATORS,
    store: cache.kind,
    examples: [],
  };
  return json(body);
});
