import { hasBypass } from "@/lib/access";
import { getCache } from "@/lib/cache";
import { getConfig, TTL_SECONDS } from "@/lib/config";
import { fromZodError } from "@/lib/errors";
import { briefId } from "@/lib/hash";
import { keys } from "@/lib/keys";
import { generateQueries } from "@/lib/llm";
import {
  checkVisitorBrief,
  countVisitorBrief,
  visitorId,
} from "@/lib/rate-limit";
import { handle, json, readJson } from "@/lib/route";
import { Brief, type BriefRecord, type BriefResponse } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle("brief", async (request, ctx) => {
  const parsed = Brief.safeParse(await readJson(request));
  if (!parsed.success) throw fromZodError(parsed.error);
  const brief = parsed.data;
  const id = briefId(brief);
  ctx.log.briefId = id;

  const cache = getCache();
  const existing = await cache.get<BriefRecord>(keys.brief(id));
  if (existing) {
    ctx.log.cached = true;
    const body: BriefResponse = {
      briefId: id,
      queries: existing.queries,
      cached: true,
    };
    return json(body);
  }

  // A cache miss spends a model request, so it counts against the visitor.
  const config = getConfig();
  const visitor = visitorId(request, config);
  const bypass = hasBypass(request, config);
  ctx.log.visitor = visitor;
  ctx.log.bypass = bypass;
  await checkVisitorBrief({ cache, config, visitor, bypass });
  await countVisitorBrief({ cache, config, visitor });

  const started = Date.now();
  const queries = await generateQueries(brief);
  ctx.log.llm_ms = Date.now() - started;

  const record: BriefRecord = {
    briefId: id,
    brief,
    queries,
    createdAt: new Date().toISOString(),
  };
  await cache.set(keys.brief(id), record, TTL_SECONDS.brief);

  const body: BriefResponse = { briefId: id, queries, cached: false };
  return json(body);
});
