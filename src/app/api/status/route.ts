import { hasBypass } from "@/lib/access";
import { getCache } from "@/lib/cache";
import { listExamples } from "@/lib/examples";
import { LIMITS, getConfig } from "@/lib/config";
import {
  budgetState,
  visitorId,
  visitorSearchStatus,
  youtubeSearchesToday,
} from "@/lib/rate-limit";
import { handle, json } from "@/lib/route";
import type { StatusResponse } from "@/lib/schemas";

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
  const started = Date.now();
  const searchesUsed = await youtubeSearchesToday(cache);
  const visitorStatus = await visitorSearchStatus({
    cache,
    config,
    visitor,
    bypass,
  });
  ctx.log.cache_ms = Date.now() - started;
  ctx.log.searches_today = searchesUsed;

  const body: StatusResponse = {
    visitor: visitorStatus,
    budget: budgetState(searchesUsed, config, bypass),
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
