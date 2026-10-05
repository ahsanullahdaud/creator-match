import { getCache, type CacheStore } from "./cache";
import { getConfig, TTL_SECONDS, type Config } from "./config";
import { AppError } from "./errors";
import { keys } from "./keys";

interface LimitContext {
  cache?: CacheStore;
  config?: Config;
  now?: Date;
}

export async function llmRequestsToday(
  cache: CacheStore = getCache(),
  now: Date = new Date(),
): Promise<number> {
  return (await cache.get<number>(keys.llmRequests(now))) ?? 0;
}

/**
 * Counts one live LLM request against today's budget and returns the new
 * total, or throws budget_exhausted before anything is spent.
 */
export async function reserveLlmRequest(
  context: LimitContext = {},
): Promise<number> {
  const cache = context.cache ?? getCache();
  const config = context.config ?? getConfig();
  const now = context.now ?? new Date();
  const used = await llmRequestsToday(cache, now);
  if (used >= config.LLM_DAILY_REQUEST_BUDGET) {
    throw new AppError(
      "budget_exhausted",
      "Today's AI request budget is used up. Try one of the example briefs.",
    );
  }
  return cache.incr(keys.llmRequests(now), TTL_SECONDS.llmCounter);
}
