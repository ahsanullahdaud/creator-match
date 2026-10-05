import { LIMITS } from "./config";
import type { Brief, Creator, MatchedVideo } from "./schemas";
import type { ChannelInfo, SearchHit } from "./youtube";

/** A channel as seen across the search results, before stats are known. */
export interface ChannelHits {
  channelId: string;
  /** Number of queries whose results included this channel. */
  hits: number;
  /** Newest matched videos, at most MATCHED_VIDEOS_PER_CREATOR. */
  videos: MatchedVideo[];
  /** ISO date of the newest matched video, "" when unknown. */
  latest: string;
}

/** Folds per-query search hits into one entry per channel. */
export function aggregateHits(perQuery: SearchHit[][]): ChannelHits[] {
  const map = new Map<
    string,
    { hits: number; videos: Map<string, MatchedVideo>; latest: string }
  >();
  for (const hits of perQuery) {
    const seenInThisQuery = new Set<string>();
    for (const hit of hits) {
      let entry = map.get(hit.channelId);
      if (!entry) {
        entry = { hits: 0, videos: new Map(), latest: "" };
        map.set(hit.channelId, entry);
      }
      if (!seenInThisQuery.has(hit.channelId)) {
        entry.hits += 1;
        seenInThisQuery.add(hit.channelId);
      }
      if (!entry.videos.has(hit.videoId)) {
        entry.videos.set(hit.videoId, {
          videoId: hit.videoId,
          title: hit.title,
          publishedAt: hit.publishedAt,
        });
      }
      if (hit.publishedAt > entry.latest) entry.latest = hit.publishedAt;
    }
  }
  return [...map.entries()].map(([channelId, entry]) => ({
    channelId,
    hits: entry.hits,
    latest: entry.latest,
    videos: [...entry.videos.values()]
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, LIMITS.MATCHED_VIDEOS_PER_CREATOR),
  }));
}

/** Most-hit channels first, newest video breaking ties, capped for channels.list. */
export function pickCandidates(
  channels: ChannelHits[],
  max: number = LIMITS.MAX_CANDIDATES,
): ChannelHits[] {
  return [...channels]
    .sort((a, b) => b.hits - a.hits || b.latest.localeCompare(a.latest))
    .slice(0, max);
}

/** [inclusive lower, exclusive upper) subscriber bounds for a range. */
export function subscriberBounds(
  range: Brief["subscriberRange"],
): [number, number] {
  switch (range) {
    case "1k-10k":
      return [1_000, 10_000];
    case "10k-100k":
      return [10_000, 100_000];
    case "100k-1m":
      return [100_000, 1_000_000];
    case "1m-plus":
      return [1_000_000, Number.POSITIVE_INFINITY];
    default:
      return [0, Number.POSITIVE_INFINITY];
  }
}

export function eligible(channel: ChannelInfo, brief: Brief): boolean {
  if (channel.hiddenSubscriberCount) return false;
  if (channel.videoCount < LIMITS.MIN_VIDEO_COUNT) return false;
  const [low, high] = subscriberBounds(brief.subscriberRange);
  return channel.subscriberCount >= low && channel.subscriberCount < high;
}

export function toCreator(channel: ChannelInfo, hits: ChannelHits): Creator {
  return {
    channelId: channel.channelId,
    title: channel.title,
    handle: channel.handle,
    description: channel.description.slice(0, 300),
    thumbnailUrl: channel.thumbnailUrl,
    country: channel.country,
    subscriberCount: channel.subscriberCount,
    videoCount: channel.videoCount,
    viewCount: channel.viewCount,
    hits: hits.hits,
    matchedVideos: hits.videos,
    url: channel.handle
      ? `https://www.youtube.com/${channel.handle}`
      : `https://www.youtube.com/channel/${channel.channelId}`,
  };
}

const DAY_MS = 24 * 3600 * 1000;

function recencyBonus(creator: Creator, now: Date): number {
  const latest = creator.matchedVideos
    .map((v) => Date.parse(v.publishedAt))
    .filter((t) => Number.isFinite(t))
    .reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(latest)) return 0;
  const days = (now.getTime() - latest) / DAY_MS;
  if (days <= 90) return 1;
  if (days <= 365) return 0.5;
  return 0;
}

/** hits * 3 + rangeFit + recencyBonus + regionMatch. Higher is better. */
export function scoreCreator(
  creator: Creator,
  brief: Brief,
  now: Date,
): number {
  const rangeFit = brief.subscriberRange === "any" ? 0 : 1;
  const regionMatch =
    brief.region !== "any" && creator.country === brief.region ? 1 : 0;
  return creator.hits * 3 + rangeFit + recencyBonus(creator, now) + regionMatch;
}

export function rankCreators(
  creators: Creator[],
  brief: Brief,
  now: Date = new Date(),
  max: number = LIMITS.MAX_CREATORS,
): Creator[] {
  return creators
    .map((creator) => ({ creator, score: scoreCreator(creator, brief, now) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.creator.subscriberCount - a.creator.subscriberCount,
    )
    .slice(0, max)
    .map((entry) => entry.creator);
}

/** Filter, join with hit counts, rank, cap. The whole post-YouTube pipeline. */
export function selectCreators(
  channels: ChannelInfo[],
  hits: ChannelHits[],
  brief: Brief,
  now: Date = new Date(),
): Creator[] {
  const byId = new Map(hits.map((h) => [h.channelId, h]));
  const creators = channels
    .filter((channel) => eligible(channel, brief))
    .flatMap((channel) => {
      const channelHits = byId.get(channel.channelId);
      return channelHits ? [toCreator(channel, channelHits)] : [];
    });
  return rankCreators(creators, brief, now);
}
