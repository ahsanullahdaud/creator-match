import { getCache } from "@/lib/cache";
import { TTL_SECONDS } from "@/lib/config";
import { fromZodError } from "@/lib/errors";
import { briefId } from "@/lib/hash";
import { keys } from "@/lib/keys";
import { generateQueries } from "@/lib/llm";
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
