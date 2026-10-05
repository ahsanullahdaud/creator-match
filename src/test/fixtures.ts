import {
  Brief,
  type Creator,
  type CreatorScore,
  type QueryPlan,
} from "@/lib/schemas";

export const briefFixture: Brief = Brief.parse({
  brandName: "Peak Fuel",
  product: "Electrolyte drink mix for long-distance runners",
  audience: "Amateur marathon and half-marathon runners",
  goal: "awareness",
  subscriberRange: "10k-100k",
  region: "US",
  language: "en",
});

export const queryPlanFixture: QueryPlan = {
  queries: [
    {
      q: "marathon training tips",
      intent: "Finds running coaches whose viewers are training for a race.",
    },
    {
      q: "hydration for long runs",
      intent: "Finds creators already talking about electrolytes.",
    },
    {
      q: "half marathon vlog",
      intent: "Finds amateur runners documenting their own races.",
    },
  ],
  contentThemes: ["running", "endurance training", "race day"],
  avoid: ["pro cycling", "gym bodybuilding"],
};

export const creatorFixture: Creator = {
  channelId: "UC_peakfuel_1",
  title: "Run With Sam",
  handle: "@runwithsam",
  description:
    "Weekly training vlogs and race recaps from an amateur marathoner.",
  thumbnailUrl: "https://yt3.example.com/sam.jpg",
  country: "US",
  subscriberCount: 42_000,
  videoCount: 180,
  viewCount: 6_500_000,
  hits: 2,
  matchedVideos: [
    {
      videoId: "v1",
      title: "What I drink on a 20 mile long run",
      publishedAt: "2026-08-14T12:00:00Z",
      viewCount: 31_000,
    },
  ],
  url: "https://www.youtube.com/channel/UC_peakfuel_1",
};

export const creatorScoreFixture: CreatorScore = {
  fitScore: 82,
  verdict: "strong",
  reasons: [
    "Audience is amateur marathoners, the exact brief audience.",
    "Recent long-run video already discusses hydration.",
  ],
  concerns: ["Posting cadence slowed over the summer."],
  audienceOverlap:
    "Viewers are recreational runners preparing for their first or second marathon.",
  outreach: {
    angle: "Sponsor the next 20 mile long run with a hydration experiment.",
    subjectLine: "Fuel for your next 20 miler",
    openingMessage:
      "Hi Sam, your long-run fueling video matched how our runners think about hydration. We make Peak Fuel, an electrolyte mix built for marathon training, and would love to send you a trial batch for your next build.",
  },
};

// ----- YouTube payloads and pipeline inputs -----

import type { ChannelInfo, SearchHit } from "@/lib/youtube";

export interface SearchItemSpec {
  channelId: string;
  videoId: string;
  title?: string;
  publishedAt?: string;
}

/** The shape search.list returns, trimmed to the fields we read. */
export function youtubeSearchResponse(items: SearchItemSpec[]) {
  return {
    items: items.map((item) => ({
      id: { kind: "youtube#video", videoId: item.videoId },
      snippet: {
        channelId: item.channelId,
        title: item.title ?? `Video ${item.videoId}`,
        publishedAt: item.publishedAt ?? "2026-09-01T00:00:00Z",
        channelTitle: `Channel ${item.channelId}`,
      },
    })),
  };
}

export interface ChannelItemOverrides {
  subscriberCount?: number;
  videoCount?: number;
  viewCount?: number;
  hidden?: boolean;
  country?: string;
  customUrl?: string;
  thumbnails?: boolean;
}

/** One item as channels.list returns it. */
export function youtubeChannelItem(id: string, o: ChannelItemOverrides = {}) {
  return {
    id,
    snippet: {
      title: `Channel ${id}`,
      description: `About ${id}`,
      customUrl: o.customUrl ?? `@${id.toLowerCase()}`,
      country: o.country,
      thumbnails:
        o.thumbnails === false
          ? undefined
          : {
              default: { url: `https://yt3.ggpht.com/${id}=s88` },
              medium: { url: `https://yt3.ggpht.com/${id}=s240` },
            },
    },
    statistics: {
      subscriberCount: String(o.subscriberCount ?? 42_000),
      videoCount: String(o.videoCount ?? 180),
      viewCount: String(o.viewCount ?? 6_500_000),
      hiddenSubscriberCount: o.hidden ?? false,
    },
  };
}

export function channelInfoFixture(
  id: string,
  overrides: Partial<ChannelInfo> = {},
): ChannelInfo {
  return {
    channelId: id,
    title: `Channel ${id}`,
    handle: `@${id.toLowerCase()}`,
    description: `About ${id}`,
    thumbnailUrl: `https://yt3.ggpht.com/${id}=s240`,
    country: "US",
    subscriberCount: 42_000,
    videoCount: 180,
    viewCount: 6_500_000,
    hiddenSubscriberCount: false,
    ...overrides,
  };
}

export function searchHit(
  channelId: string,
  videoId: string,
  publishedAt = "2026-09-01T00:00:00Z",
  title?: string,
): SearchHit {
  return {
    channelId,
    videoId,
    title: title ?? `Video ${videoId}`,
    publishedAt,
  };
}
