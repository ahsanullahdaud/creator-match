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
