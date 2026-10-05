import { getCache, type CacheStore } from "./cache";
import { getConfig, LIMITS, TTL_SECONDS, type Config } from "./config";
import { AppError } from "./errors";
import { ipHash } from "./hash";
import { keys } from "./keys";
import type { BudgetState, VisitorStatus } from "./schemas";

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

// ----- Per-visitor buckets (hashed IP, UTC day) -----

/** First x-forwarded-for entry (what Vercel sets), else x-real-ip, else "local". */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const real = request.headers.get("x-real-ip")?.trim();
  return real || "local";
}

/** Salted hash of the visitor IP; the only form that reaches the cache or logs. */
export function visitorId(
  request: Request,
  config: Config = getConfig(),
): string {
  return ipHash(clientIp(request), config.RATE_LIMIT_SALT);
}

interface VisitorContext extends LimitContext {
  visitor: string;
  /** A passcode holder: limits are reported but never enforced. */
  bypass?: boolean;
}

function resolve(context: VisitorContext) {
  return {
    cache: context.cache ?? getCache(),
    config: context.config ?? getConfig(),
    now: context.now ?? new Date(),
    visitor: context.visitor,
    bypass: Boolean(context.bypass),
  };
}

export async function visitorSearchStatus(
  context: VisitorContext,
): Promise<VisitorStatus> {
  const { cache, config, now, visitor, bypass } = resolve(context);
  const used = (await cache.get<number>(keys.rlSearch(visitor, now))) ?? 0;
  const limit = config.VISITOR_SEARCH_LIMIT;
  return {
    remaining: bypass ? limit : Math.max(0, limit - used),
    limit,
    bypass,
  };
}

/** Throws visitor_limit when this visitor has no live searches left today. */
export async function checkVisitorSearch(
  context: VisitorContext,
): Promise<VisitorStatus> {
  const status = await visitorSearchStatus(context);
  if (!status.bypass && status.remaining <= 0) {
    throw new AppError(
      "visitor_limit",
      "You have used today's live searches. The example briefs still work.",
    );
  }
  return status;
}

/** Counts one live search run (a /api/search call that hit YouTube at least once). */
export async function countVisitorSearch(
  context: VisitorContext,
): Promise<number> {
  const { cache, now, visitor } = resolve(context);
  return cache.incr(keys.rlSearch(visitor, now), TTL_SECONDS.visitorBucket);
}

/** Throws visitor_limit when this visitor has generated too many briefs today. */
export async function checkVisitorBrief(
  context: VisitorContext,
): Promise<void> {
  const { cache, config, now, visitor, bypass } = resolve(context);
  if (bypass) return;
  const used = (await cache.get<number>(keys.rlBrief(visitor, now))) ?? 0;
  if (used >= config.VISITOR_BRIEF_LIMIT) {
    throw new AppError(
      "visitor_limit",
      "You have generated enough new briefs for today. The example briefs still work.",
    );
  }
}

/** Counts one live query generation (a /api/brief cache miss). */
export async function countVisitorBrief(
  context: VisitorContext,
): Promise<number> {
  const { cache, now, visitor } = resolve(context);
  return cache.incr(keys.rlBrief(visitor, now), TTL_SECONDS.visitorBucket);
}
