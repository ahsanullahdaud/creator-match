import { getCache, type CacheStore } from "./cache";
import { getConfig, LIMITS, TTL_SECONDS, type Config } from "./config";
import { AppError } from "./errors";
import { keys } from "./keys";
import type { BudgetState } from "./schemas";

interface LimitContext {
  cache?: CacheStore;
  config?: Config;
  now?: Date;
}

// ----- LLM requests -----

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

// ----- YouTube search.list (its own bucket of 100 calls per day) -----

export async function youtubeSearchesToday(
  cache: CacheStore = getCache(),
  now: Date = new Date(),
): Promise<number> {
  return (await cache.get<number>(keys.ytSearches(now))) ?? 0;
}

/**
 * Counts one search.list call against today's budget (the public threshold,
 * or the total one for a passcode holder) and returns the new total, or
 * throws budget_exhausted before the call is made.
 */
export async function reserveYoutubeSearch(
  context: LimitContext & { bypass?: boolean } = {},
): Promise<number> {
  const cache = context.cache ?? getCache();
  const config = context.config ?? getConfig();
  const now = context.now ?? new Date();
  const budget = context.bypass
    ? config.YT_TOTAL_SEARCH_BUDGET
    : config.YT_PUBLIC_SEARCH_BUDGET;
  const used = await youtubeSearchesToday(cache, now);
  if (used >= budget) {
    throw new AppError(
      "budget_exhausted",
      "Today's live search budget is used up. Try one of the example briefs.",
    );
  }
  return cache.incr(keys.ytSearches(now), TTL_SECONDS.ytCounter);
}

/** One unit from the 10,000-unit pool (channels.list, videos.list). */
export async function countYoutubeUnit(
  cache: CacheStore = getCache(),
  now: Date = new Date(),
): Promise<number> {
  return cache.incr(keys.ytUnits(now), TTL_SECONDS.ytCounter);
}

/** How the public search budget looks right now, for banners and responses. */
export function budgetState(
  searchesUsed: number,
  config: Config = getConfig(),
): BudgetState {
  const remaining = config.YT_PUBLIC_SEARCH_BUDGET - searchesUsed;
  if (remaining <= 0) return "exhausted";
  if (remaining < LIMITS.LOW_BUDGET_THRESHOLD) return "low";
  return "ok";
}
