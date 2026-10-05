import { z } from "zod";

// ----- Brief (user input) -----
export const CampaignGoal = z.enum([
  "awareness",
  "product_launch",
  "conversions",
  "app_installs",
  "ugc",
]);
export const SubscriberRange = z.enum([
  "any",
  "1k-10k",
  "10k-100k",
  "100k-1m",
  "1m-plus",
]);
export const Region = z.enum([
  "any",
  "US",
  "GB",
  "CA",
  "AU",
  "IN",
  "PK",
  "DE",
  "FR",
  "BR",
]);
export const Language = z.enum([
  "any",
  "en",
  "es",
  "de",
  "fr",
  "pt",
  "hi",
  "ur",
]);

export const Brief = z.object({
  brandName: z.string().trim().min(1).max(80),
  product: z.string().trim().min(3).max(300),
  audience: z.string().trim().min(3).max(300),
  goal: CampaignGoal.default("awareness"),
  subscriberRange: SubscriberRange.default("10k-100k"),
  region: Region.default("any"),
  language: Language.default("en"),
  notes: z.string().trim().max(1000).default(""),
});
export type Brief = z.infer<typeof Brief>;
export type BriefInput = z.input<typeof Brief>;

// ----- Claude output 1: query plan (fast model) -----
// Sent to the structured outputs API, which supports a subset of JSON Schema:
// no numeric, length or regex constraints here. Ranges live in .describe().
export const QueryPlan = z.object({
  queries: z
    .array(
      z.object({
        q: z
          .string()
          .describe(
            "What a viewer types into YouTube search. 2 to 6 words. No brand names.",
          ),
        intent: z
          .string()
          .describe("One sentence: why this query surfaces relevant creators."),
      }),
    )
    .describe("Exactly 3 queries, each targeting a different angle."),
  contentThemes: z
    .array(z.string())
    .describe("Up to 5 themes a well-matched channel covers."),
  avoid: z
    .array(z.string())
    .describe("Up to 3 signals that a channel is a poor fit."),
});
export type QueryPlan = z.infer<typeof QueryPlan>;

// ----- YouTube-derived creator -----
export const MatchedVideo = z.object({
  videoId: z.string(),
  title: z.string(),
  publishedAt: z.string(),
  viewCount: z.number().int().nonnegative().optional(),
});
export type MatchedVideo = z.infer<typeof MatchedVideo>;

export const Creator = z.object({
  channelId: z.string(),
  title: z.string(),
  handle: z.string().optional(), // customUrl, e.g. "@runwithsam"
  description: z.string(),
  thumbnailUrl: z.url(),
  country: z.string().optional(),
  subscriberCount: z.number().int().nonnegative(),
  videoCount: z.number().int().nonnegative(),
  viewCount: z.number().int().nonnegative(),
  hits: z.number().int().positive(), // how many queries surfaced this channel
  matchedVideos: z.array(MatchedVideo), // up to 3
  url: z.url(),
});
export type Creator = z.infer<typeof Creator>;

// ----- Claude output 2: fit score (score model) -----
export const CreatorScore = z.object({
  fitScore: z.number().describe("0 to 100. 80+ only for an obvious fit."),
  verdict: z.enum(["strong", "possible", "weak"]),
  reasons: z
    .array(z.string())
    .describe("2 to 4 short, specific reasons grounded in the channel data."),
  concerns: z
    .array(z.string())
    .describe("0 to 3 concerns, e.g. audience mismatch or inactive channel."),
  audienceOverlap: z
    .string()
    .describe(
      "One sentence on who watches this channel vs the brief's audience.",
    ),
  outreach: z.object({
    angle: z
      .string()
      .describe(
        "The one idea that makes this collaboration make sense for the creator.",
      ),
    subjectLine: z.string(),
    openingMessage: z
      .string()
      .describe("Under 120 words, plain text, first person from the brand."),
  }),
});
export type CreatorScore = z.infer<typeof CreatorScore>;

/** The model is asked for 0 to 100 but the schema cannot enforce it. */
export function clampFitScore(score: CreatorScore): CreatorScore {
  const raw = Number.isFinite(score.fitScore) ? score.fitScore : 0;
  return { ...score, fitScore: Math.round(Math.min(100, Math.max(0, raw))) };
}

export const ScoredCreator = Creator.extend({ score: CreatorScore.nullable() });
export type ScoredCreator = z.infer<typeof ScoredCreator>;

// One scoring request covers a batch of creators; each result names its channel.
export const CreatorScoreBatch = z.object({
  scores: z.array(CreatorScore.extend({ channelId: z.string() })),
});
export type CreatorScoreBatch = z.infer<typeof CreatorScoreBatch>;

// ----- Errors -----
export const ErrorCode = z.enum([
  "invalid_request",
  "not_found",
  "visitor_limit",
  "budget_exhausted",
  "score_cap",
  "youtube_error",
  "llm_error",
  "forbidden",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponse = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    retryable: z.boolean().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

// ----- Cache records -----
export const BriefRecord = z.object({
  briefId: z.string(),
  brief: Brief,
  queries: QueryPlan,
  createdAt: z.string(),
});
export type BriefRecord = z.infer<typeof BriefRecord>;

export const SearchRecord = z.object({
  briefId: z.string(),
  creators: z.array(Creator),
  liveSearches: z.number().int(),
  createdAt: z.string(),
});
export type SearchRecord = z.infer<typeof SearchRecord>;

export const ScoreRecord = z.object({
  briefId: z.string(),
  channelId: z.string(),
  score: CreatorScore,
  model: z.string(),
  createdAt: z.string(),
});
export type ScoreRecord = z.infer<typeof ScoreRecord>;

export const Example = z.object({
  slug: z.string(),
  title: z.string(),
  blurb: z.string(),
  brief: BriefRecord,
  search: SearchRecord,
  scores: z.array(ScoreRecord),
  precomputedAt: z.string(),
});
export type Example = z.infer<typeof Example>;

// ----- API contracts -----
export const VisitorStatus = z.object({
  remaining: z.number().int(),
  limit: z.number().int(),
  bypass: z.boolean(),
});
export type VisitorStatus = z.infer<typeof VisitorStatus>;

export const BudgetState = z.enum(["ok", "low", "exhausted"]);
export type BudgetState = z.infer<typeof BudgetState>;

export const BriefResponse = z.object({
  briefId: z.string(),
  queries: QueryPlan,
  cached: z.boolean(),
});
export type BriefResponse = z.infer<typeof BriefResponse>;

export const SearchRequest = z.object({ briefId: z.string().length(16) });
export type SearchRequest = z.infer<typeof SearchRequest>;

export const SearchResponse = z.object({
  briefId: z.string(),
  creators: z.array(Creator),
  cached: z.boolean(),
  visitor: VisitorStatus,
  budget: BudgetState,
});
export type SearchResponse = z.infer<typeof SearchResponse>;

export const ScoreRequest = z.object({
  briefId: z.string().length(16),
  channelIds: z.array(z.string()).min(1).max(10),
});
export type ScoreRequest = z.infer<typeof ScoreRequest>;

export const ScoreLine = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("score"),
    channelId: z.string(),
    score: CreatorScore,
    cached: z.boolean(),
  }),
  z.object({
    type: z.literal("error"),
    channelId: z.string(),
    code: ErrorCode,
    message: z.string(),
    retryable: z.boolean(),
  }),
  z.object({
    type: z.literal("done"),
    scored: z.number().int(),
    failed: z.number().int(),
  }),
]);
export type ScoreLine = z.infer<typeof ScoreLine>;

export const PasscodeRequest = z.object({
  passcode: z.string().min(1).max(200),
});
export type PasscodeRequest = z.infer<typeof PasscodeRequest>;

export const StatusResponse = z.object({
  visitor: VisitorStatus,
  budget: BudgetState,
  maxCreators: z.number().int(),
  store: z.enum(["memory", "redis"]),
  examples: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      blurb: z.string(),
      brief: Brief,
    }),
  ),
});
export type StatusResponse = z.infer<typeof StatusResponse>;
