import { getCache } from "./cache";
import { getConfig, LIMITS, TTL_SECONDS } from "./config";
import { AppError } from "./errors";
import { queryHash } from "./hash";
import { keys } from "./keys";
import { countYoutubeUnit, reserveYoutubeSearch } from "./rate-limit";

const API = "https://www.googleapis.com/youtube/v3";
const FALLBACK_THUMBNAIL =
  "https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png";

export interface SearchHit {
  channelId: string;
  videoId: string;
  title: string;
  publishedAt: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** True when this call spent a search.list request. */
  live: boolean;
}

export interface ChannelInfo {
  channelId: string;
  title: string;
  handle?: string;
  description: string;
  thumbnailUrl: string;
  country?: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  hiddenSubscriberCount: boolean;
}

interface SearchListResponse {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: { channelId?: string; title?: string; publishedAt?: string };
  }>;
}

interface ChannelItem {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    customUrl?: string;
    country?: string;
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
  statistics?: {
    subscriberCount?: string;
    videoCount?: string;
    viewCount?: string;
    hiddenSubscriberCount?: boolean;
  };
}

interface ChannelListResponse {
  items?: ChannelItem[];
}

interface YoutubeErrorBody {
  error?: { message?: string; errors?: Array<{ reason?: string }> };
}

const QUOTA_REASONS = new Set([
  "quotaExceeded",
  "dailyLimitExceeded",
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

function apiKey(): string {
  const key = getConfig().YOUTUBE_API_KEY;
  if (!key) throw new AppError("internal", "YOUTUBE_API_KEY is not set");
  return key;
}

/** One YouTube call. The key goes in the URL and never into an error message. */
async function youtubeGet<T>(
  resource: string,
  params: Record<string, string>,
): Promise<T> {
  const url = new URL(`${API}/${resource}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  url.searchParams.set("key", apiKey());

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { accept: "application/json" },
    });
  } catch (error) {
    throw new AppError("youtube_error", `YouTube ${resource} request failed`, {
      retryable: true,
      cause: error,
    });
  }
  if (res.ok) return (await res.json()) as T;

  let body: YoutubeErrorBody = {};
  try {
    body = (await res.json()) as YoutubeErrorBody;
  } catch {
    body = {};
  }
  const reason = body.error?.errors?.[0]?.reason ?? "";
  if (QUOTA_REASONS.has(reason)) {
    throw new AppError(
      "budget_exhausted",
      "YouTube quota is used up for today. Try one of the example briefs.",
      { cause: body },
    );
  }
  const detail = body.error?.message ?? res.statusText ?? "";
  const label = reason ? `${res.status} ${reason}` : String(res.status);
  throw new AppError(
    "youtube_error",
    `YouTube ${resource} failed (${label}): ${detail}`,
    { retryable: res.status >= 500 || res.status === 429, cause: body },
  );
}

/**
 * search.list for one query, cached 7 days by normalized query plus filters.
 * A cache miss reserves one of today's searches before calling YouTube.
 */
export async function searchVideos(
  q: string,
  region: string,
  language: string,
  options: { bypass?: boolean } = {},
): Promise<SearchResult> {
  const cache = getCache();
  const key = keys.ytSearch(queryHash(q, region, language));
  const cached = await cache.get<SearchHit[]>(key);
  if (cached) return { hits: cached, live: false };

  await reserveYoutubeSearch({ cache, bypass: options.bypass });

  const params: Record<string, string> = {
    part: "snippet",
    type: "video",
    maxResults: String(LIMITS.SEARCH_MAX_RESULTS),
    order: "relevance",
    safeSearch: "moderate",
    q,
  };
  if (region !== "any") params.regionCode = region;
  if (language !== "any") params.relevanceLanguage = language;

  const data = await youtubeGet<SearchListResponse>("search", params);
  const hits: SearchHit[] = [];
  for (const item of data.items ?? []) {
    const videoId = item.id?.videoId;
    const channelId = item.snippet?.channelId;
    if (!videoId || !channelId) continue;
    hits.push({
      channelId,
      videoId,
      title: item.snippet?.title ?? "",
      publishedAt: item.snippet?.publishedAt ?? "",
    });
  }
  await cache.set(key, hits, TTL_SECONDS.ytSearch);
  return { hits, live: true };
}

function toInt(value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function toChannelInfo(item: ChannelItem): ChannelInfo | null {
  if (!item.id) return null;
  const snippet = item.snippet ?? {};
  const stats = item.statistics ?? {};
  const thumbs = snippet.thumbnails ?? {};
  const handle = snippet.customUrl?.startsWith("@")
    ? snippet.customUrl
    : undefined;
  return {
    channelId: item.id,
    title: snippet.title ?? "Unknown channel",
    handle,
    description: snippet.description ?? "",
    thumbnailUrl:
      thumbs.medium?.url ??
      thumbs.default?.url ??
      thumbs.high?.url ??
      FALLBACK_THUMBNAIL,
    country: snippet.country,
    subscriberCount: toInt(stats.subscriberCount),
    videoCount: toInt(stats.videoCount),
    viewCount: toInt(stats.viewCount),
    hiddenSubscriberCount: Boolean(stats.hiddenSubscriberCount),
  };
}

/**
 * channels.list for up to 50 ids. Cached per channel for 24 h; only the
 * misses are fetched, in one call that costs one quota unit.
 */
export async function getChannels(
  channelIds: string[],
): Promise<ChannelInfo[]> {
  const cache = getCache();
  const unique = [...new Set(channelIds)].slice(0, 50);
  const found = new Map<string, ChannelInfo>();
  const missing: string[] = [];

  await Promise.all(
    unique.map(async (id) => {
      const hit = await cache.get<ChannelInfo>(keys.ytChannel(id));
      if (hit) found.set(id, hit);
      else missing.push(id);
    }),
  );

  if (missing.length > 0) {
    await countYoutubeUnit(cache);
    const data = await youtubeGet<ChannelListResponse>("channels", {
      part: "snippet,statistics",
      id: missing.join(","),
      maxResults: "50",
    });
    for (const item of data.items ?? []) {
      const info = toChannelInfo(item);
      if (!info) continue;
      found.set(info.channelId, info);
      await cache.set(
        keys.ytChannel(info.channelId),
        info,
        TTL_SECONDS.ytChannel,
      );
    }
  }

  return unique.flatMap((id) => {
    const info = found.get(id);
    return info ? [info] : [];
  });
}
