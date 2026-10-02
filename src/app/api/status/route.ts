import { getCache } from "@/lib/cache";
import { LIMITS, getConfig } from "@/lib/config";
import { handle, json } from "@/lib/route";
import type { StatusResponse } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle("status", async (_request, ctx) => {
  const config = getConfig();
  const cache = getCache();

  // A real round trip, so bad Redis credentials show up here and not in /api/search.
  const started = Date.now();
  await cache.get("status:probe");
  ctx.log.cache_ms = Date.now() - started;

  // Visitor counters, budget state and examples arrive in later steps.
  const body: StatusResponse = {
    visitor: {
      remaining: config.VISITOR_SEARCH_LIMIT,
      limit: config.VISITOR_SEARCH_LIMIT,
      bypass: false,
    },
    budget: "ok",
    maxCreators: LIMITS.MAX_CREATORS,
    store: cache.kind,
    examples: [],
  };
  return json(body);
});
