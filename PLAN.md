# Creator Match - Build Plan

A brand submits a brief. The server asks an LLM (Google Gemini on the free tier, behind a provider-agnostic module) for YouTube search queries, searches YouTube Data API v3 for videos, aggregates the channels behind them, pulls channel stats, then asks the LLM to score each creator's fit and draft an outreach angle. Next.js 16 App Router, TypeScript, Tailwind v4, deployed on Vercel from GitHub. No auth, no database. Upstash Redis (Vercel Marketplace) is the cache and rate-limit store.

## Goals and hard limits

| Target                       | Value                                   | Why                                                       |
| ---------------------------- | --------------------------------------- | --------------------------------------------------------- |
| End-to-end latency           | < 20 s, cards visible < 8 s             | Live demo from a CV link                                  |
| Creators scored per brief    | max 10 (`MAX_CREATORS`)                 | Latency and LLM quota                                     |
| LLM requests per fresh brief | 3 (1 query plan + 2 score batches of 5) | Gemini free tier is capped per day, so scoring is batched |
| LLM concurrency              | 2 (`LLM_CONCURRENCY`)                   | Gemini free tier allows few requests per minute           |
| LLM daily request budget     | 450 (`LLM_DAILY_REQUEST_BUDGET`)        | Fail closed before Gemini returns 429                     |
| Search queries per brief     | max 3 (`MAX_QUERIES`)                   | 3 search calls per fresh brief                            |
| Live searches per visitor    | 3 per UTC day by hashed IP              | Open page, tiny quota                                     |
| Global search budget         | 60 calls/day public, 95 with passcode   | YouTube allows 100 `search.list` calls/day                |
| Examples                     | 3 precomputed briefs, zero API calls    | Page keeps working when the budget is gone                |

Budget math: 60 public search calls / 3 per fresh brief = about 20 fresh public briefs per day, plus unlimited cache hits and example views. The passcode holder has about 11 more.

A fresh brief also costs 3 LLM requests (one query plan, two score batches), so 20 public briefs are about 60 Gemini requests a day, well inside the free tier's daily cap for Flash-Lite.

YouTube quota (verified against the quota docs): `search.list` has its own bucket of 100 calls per day. `channels.list` and `videos.list` cost 1 unit each from a separate 10,000 unit pool. Both reset at midnight Pacific.

Gemini free tier (checked against ai.google.dev on 2026-10-05): the official SDK is `@google/genai` (Node 20+). The current text models with a free tier are Gemini 3.8 Flash, 3.5 Flash, 3.5 Flash-Lite and 3.1 Flash-Lite; 3.1 Pro is paid only. Free-tier input and output tokens cost nothing, but Google may use free-tier content to improve its products. Requests per minute and per day are not printed in the docs; they are shown per project at aistudio.google.com/rate-limit and change without notice (this project's AI Studio page on 2026-10-05: 15 requests per minute and 500 per day for `gemini-3.5-flash-lite`; Gemini 3.8, 3.7, 3.6 and 3.5 Flash are each limited to 20 requests per day). Exceeding them returns `429 RESOURCE_EXHAUSTED`. Quotas reset at midnight Pacific. Structured output accepts a JSON Schema subset. Default model: `gemini-3.5-flash-lite` for both calls. The Flash models are not an option for scoring at 20 requests per day.

## Pipeline

```
Browser                          Server (route handlers, Node runtime)
-------                          -------------------------------------
POST /api/brief   ─────────────► validate → briefId → cache? → LLM budget → Gemini query model: QueryPlan
                  ◄─────────────  { briefId, queries }
POST /api/search  ─────────────► visitor limit → search budget → YouTube search.list per query (cached)
                                  → aggregate channels → channels.list (cached) → filter → rank → top 10
                  ◄─────────────  { creators[] }                               (cards render now)
POST /api/score   ─────────────► cap → LLM budget → semaphore(2) → Gemini score model, 5 creators per request (cached)
                  ◄─────────────  NDJSON stream, one line per creator as its batch completes (cards fill in)
```

Timing budget: brief ≤ 3 s, search ≤ 5 s, scores ≤ 10 s wall-clock (10 creators in two batches of 5, run concurrently on Gemini 3.5 Flash-Lite with low thinking).

Why one streamed score request instead of ten parallel ones: the concurrency cap must be enforced server-side, and ten separate function invocations cannot share a semaphore. One invocation runs the creators through a limiter and streams each result as it lands, so the UI still fills in progressively. Why batches of 5 instead of one request per creator: the free tier counts requests per day, so a brief costs 3 requests instead of 11, and a batch of 5 is small enough that one slow or failed batch only delays half the cards.

Examples are a static read-through layer in front of Redis: `cache.get()` checks precomputed example records first. The example buttons fill the form with a brief whose `briefId` matches a precomputed record, so the normal pipeline runs instantly with no API calls and no limits consumed.

## Data model (Zod, `src/lib/schemas.ts`)

Schemas are the single source of truth; types are `z.infer`. Schemas sent to the LLM are converted with `z.toJSONSchema()` (with the `$schema` key removed) and passed as the response schema. Gemini accepts a JSON Schema subset: `object`, `array`, `string`, `number`, `integer`, `boolean`, `null`, plus `required`, `additionalProperties`, `enum`, `minimum`/`maximum`, `minItems`/`maxItems`, `title` and `description`. LLM-facing schemas therefore use only objects, arrays, strings, numbers, enums and descriptions, with no optional, nullable or union fields. Ranges are described in `.describe()` and clamped after parsing.

```ts
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

// ----- LLM output 1: query plan (query model) -----
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

// ----- LLM output 2: fit score (score model) -----
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
// After parse: fitScore = Math.round(Math.min(100, Math.max(0, fitScore)))

export const ScoredCreator = Creator.extend({ score: CreatorScore.nullable() });

// One scoring request covers a batch of creators; each result names its channel.
export const CreatorScoreBatch = z.object({
  scores: z.array(CreatorScore.extend({ channelId: z.string() })),
});

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
export const ErrorResponse = z.object({
  error: z.object({ code: ErrorCode, message: z.string() }),
});

// ----- Cache records -----
export const BriefRecord = z.object({
  briefId: z.string(),
  brief: Brief,
  queries: QueryPlan,
  createdAt: z.string(),
});
export const SearchRecord = z.object({
  briefId: z.string(),
  creators: z.array(Creator),
  liveSearches: z.number().int(),
  createdAt: z.string(),
});
export const ScoreRecord = z.object({
  briefId: z.string(),
  channelId: z.string(),
  score: CreatorScore,
  model: z.string(),
  createdAt: z.string(),
});
export const Example = z.object({
  slug: z.string(),
  title: z.string(),
  blurb: z.string(),
  brief: BriefRecord,
  search: SearchRecord,
  scores: z.array(ScoreRecord),
  precomputedAt: z.string(),
});

// ----- API contracts -----
export const VisitorStatus = z.object({
  remaining: z.number().int(),
  limit: z.number().int(),
  bypass: z.boolean(),
});
export const BudgetState = z.enum(["ok", "low", "exhausted"]);

export const BriefResponse = z.object({
  briefId: z.string(),
  queries: QueryPlan,
  cached: z.boolean(),
});
export const SearchRequest = z.object({ briefId: z.string().length(16) });
export const SearchResponse = z.object({
  briefId: z.string(),
  creators: z.array(Creator),
  cached: z.boolean(),
  visitor: VisitorStatus,
  budget: BudgetState,
});
export const ScoreRequest = z.object({
  briefId: z.string().length(16),
  channelIds: z.array(z.string()).min(1).max(10),
});
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
```

### Identity and cache keys

`briefId` = first 16 hex chars of SHA-256 over the canonical JSON of the parsed Brief (defaults applied, strings trimmed and lower-cased, keys sorted). `ipHash` = first 16 hex of SHA-256(`RATE_LIMIT_SALT` + first `x-forwarded-for` entry). Query hash = SHA-256 of `q|region|language` after lower-casing and collapsing whitespace. Pacific date = `Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" })`.

| Key                            | Value                                          | TTL  |
| ------------------------------ | ---------------------------------------------- | ---- |
| `brief:{briefId}`              | BriefRecord                                    | 7 d  |
| `search:{briefId}`             | SearchRecord                                   | 7 d  |
| `score:{briefId}:{channelId}`  | ScoreRecord                                    | 7 d  |
| `scorecount:{briefId}`         | int, scores issued                             | 7 d  |
| `yt:search:{queryHash}`        | `{channelId, videoId, title, publishedAt}[]`   | 7 d  |
| `yt:channel:{channelId}`       | channel snippet + statistics                   | 24 h |
| `yt:searches:{pacificDate}`    | int, `search.list` calls today (bucket of 100) | 48 h |
| `yt:units:{pacificDate}`       | int, list units today (pool of 10,000)         | 48 h |
| `llm:requests:{pacificDate}`   | int, Gemini requests today                     | 48 h |
| `rl:search:{ipHash}:{utcDate}` | int                                            | 36 h |
| `rl:brief:{ipHash}:{utcDate}`  | int                                            | 36 h |

## API routes (`src/app/api/*/route.ts`, Node runtime)

Every route: parse body with the Zod request schema (400 `invalid_request`), read IP and cookies from the `Request` headers (never `next/headers`, so handlers are callable in tests), catch `AppError` and map to `ErrorResponse` with its status, log one JSON line with stage timings. Secrets never leave the server.

**POST /api/brief** - body `Brief`.

1. Parse, compute `briefId`. If `brief:{id}` exists (examples or Redis) return it, `cached: true`.
2. Visitor bucket `rl:brief` (10/day, passcode bypasses). 429 `visitor_limit`.
3. Check `llm:requests:{pacificDate}` against `LLM_DAILY_REQUEST_BUDGET` (503 `budget_exhausted` when spent), then `generateQueries(brief)` on `LLM_QUERY_MODEL` (default `gemini-3.5-flash-lite`, `thinking_level: "low"`, 1024 output tokens). Truncate to `MAX_QUERIES`. 502 `llm_error` when the response is blocked, empty, or still invalid JSON after one re-ask; `retryable: true` when Gemini answered 429 or 5xx after the SDK's retries.
4. Store `BriefRecord`, return `BriefResponse`.

**POST /api/search** - body `SearchRequest`.

1. Load `brief:{id}` or 404. If `search:{id}` exists return it, `cached: true`, no limits consumed.
2. Visitor bucket `rl:search` (`VISITOR_SEARCH_LIMIT` 3, passcode bypasses). 429 `visitor_limit`.
3. For each query, in parallel: hit `yt:search:{hash}`, or, if `yt:searches:{pacificDate}` is below the applicable budget (`YT_PUBLIC_SEARCH_BUDGET` 60, or `YT_TOTAL_SEARCH_BUDGET` 95 with passcode), increment the counter then call `search.list` (`part=snippet, type=video, maxResults=50, order=relevance, safeSearch=moderate`, plus `regionCode` / `relevanceLanguage` when not "any") and cache. If no query could run and none was cached, 503 `budget_exhausted`. A `quotaExceeded` error from YouTube also maps to 503 `budget_exhausted`.
4. Aggregate by `channelId`: hits, up to 3 matched videos. Keep the top 50 candidates by hits then recency.
5. `channels.list` (`part=snippet,statistics`, ≤ 50 ids, +1 unit on `yt:units`) for ids missing from `yt:channel:*`. Cache 24 h.
6. Filter (pure, tested): drop `hiddenSubscriberCount`, `videoCount < 5`, subscribers outside range. Rank = `hits * 3 + rangeFit + recencyBonus`, +1 if `country` matches region. Take `MAX_CREATORS`.
7. If at least one live `search.list` ran, increment the visitor counter. Store `SearchRecord`. Return `SearchResponse`; `budget` is `low` when fewer than 10 public searches remain.

**POST /api/score** - body `ScoreRequest`. Response is `application/x-ndjson`, one `ScoreLine` per line, `Cache-Control: no-store`.

1. Load brief and search records (404). Keep only `channelIds` present in `creators`, deduped; 400 if none remain.
2. For each id: cached `score:{id}:{channelId}` → emit `score` line immediately. Otherwise, if `scorecount:{id}` ≥ `MAX_CREATORS` → emit `error` line `score_cap`.
3. Check the LLM daily budget (emit `error` lines with `budget_exhausted` for every remaining id when spent). Split the rest into batches of `LLM_SCORE_BATCH_SIZE` (5) and run the batches through `scoreCreators` behind the semaphore (`LLM_CONCURRENCY`, 2), one Gemini request per batch. When a batch resolves: for each returned score increment `scorecount`, store `ScoreRecord`, emit a `score` line; a creator the model skipped gets an `error` line (`retryable: true`). When a batch fails, emit one `error` line per creator in it (`retryable: true` for 429, 5xx and timeouts; `false` for safety blocks or invalid JSON after the re-ask). Failures are not cached and not counted.
4. Emit `done`, close.

**POST /api/passcode** - body `{ passcode }`. Timing-safe compare with `DEMO_PASSCODE`; on match set `cm_pass` cookie (httpOnly, secure, sameSite=lax, 30 d) holding HMAC(passcode). 403 `forbidden` otherwise. **DELETE** clears it. A valid cookie means `bypass: true` for visitor limits; the global search budget still applies at the higher threshold.

**GET /api/status** - `StatusResponse` for the banner and example buttons on page load.

## Modules (`src/lib`)

| File              | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schemas.ts`      | All Zod schemas and types above                                                                                                                                                                                                                                                                                                                                                                                                      |
| `config.ts`       | `getConfig()` reads `process.env` lazily (so tests can stub it), applies defaults, validates with Zod                                                                                                                                                                                                                                                                                                                                |
| `hash.ts`         | `briefId()`, `ipHash()`, `queryHash()`, `canonicalJson()`, `pacificDate()`                                                                                                                                                                                                                                                                                                                                                           |
| `cache.ts`        | `get/set/incr` with TTL. Upstash when `KV_REST_API_URL` is set, in-memory Map otherwise, `reset()` for tests. Examples read-through in `get`                                                                                                                                                                                                                                                                                         |
| `rate-limit.ts`   | Visitor buckets, search budget, unit counter                                                                                                                                                                                                                                                                                                                                                                                         |
| `access.ts`       | Passcode cookie read/write/verify from `Request` / `Response` headers                                                                                                                                                                                                                                                                                                                                                                |
| `semaphore.ts`    | ~15 line counting semaphore, no dependency                                                                                                                                                                                                                                                                                                                                                                                           |
| `llm.ts`          | The only module the app calls for LLM work: `generateQueries(brief)` and `scoreCreators(brief, plan, creators)`. Picks the provider from `LLM_PROVIDER`, converts Zod schemas to JSON Schema, counts requests in `llm:requests:{pacificDate}`, parses and Zod-validates the returned text, clamps scores, re-asks once on invalid JSON, maps `LlmError` to `llm_error` with `retryable`. Module-level semaphore of `LLM_CONCURRENCY` |
| `llm/provider.ts` | `LlmProvider` interface, `StructuredRequest`, `StructuredResult`, `LlmError`. No SDK imports. A new provider is one file implementing it                                                                                                                                                                                                                                                                                             |
| `llm/gemini.ts`   | Gemini provider over `@google/genai`: one `GoogleGenAI` client with `httpOptions.timeout` and `httpOptions.retryOptions` (attempts = `LLM_MAX_RETRIES` + 1, on 408/429/500/502/503/504), `interactions.create` with `system_instruction`, `response_format` JSON Schema and `generation_config.thinking_level`. Translates `ApiError.status`, empty output and safety blocks into `LlmError { kind, retryable }`                     |
| `prompts.ts`      | System prompts for both calls                                                                                                                                                                                                                                                                                                                                                                                                        |
| `youtube.ts`      | `searchVideos()`, `getChannels()`, `getVideos()` via `fetch`, each through the cache and the counters. Maps `quotaExceeded` to `budget_exhausted`, other errors to `youtube_error`                                                                                                                                                                                                                                                   |
| `pipeline.ts`     | Pure: aggregate, filter, rank, pick top N                                                                                                                                                                                                                                                                                                                                                                                            |
| `ndjson.ts`       | `ndjsonResponse(asyncIterable)` server helper and `readNdjson(response, onLine)` client helper                                                                                                                                                                                                                                                                                                                                       |
| `examples.ts`     | Loads `data/examples/*.json`, exposes `lookup(key)` and the example list                                                                                                                                                                                                                                                                                                                                                             |
| `errors.ts`       | `AppError(code, message, status, retryable?)` and `toResponse()`                                                                                                                                                                                                                                                                                                                                                                     |

### LLM provider boundary (`src/lib/llm/provider.ts`)

```ts
export interface StructuredRequest {
  model: string;
  system: string; // system instruction
  prompt: string; // user content
  schema: Record<string, unknown>; // JSON Schema from z.toJSONSchema, "$schema" removed
  maxOutputTokens: number;
  thinking: "minimal" | "low" | "medium" | "high";
  timeoutMs: number;
}

export interface StructuredResult {
  text: string; // JSON text, validated by the caller
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface LlmProvider {
  readonly name: string;
  complete(request: StructuredRequest): Promise<StructuredResult>;
}

export type LlmErrorKind =
  | "rate_limit" // 429 after the SDK's retries
  | "unavailable" // 5xx after retries
  | "timeout"
  | "blocked" // safety block or empty output
  | "invalid_request"; // 400/403/404: bad key, bad model, bad schema

export class LlmError extends Error {
  kind: LlmErrorKind;
  retryable: boolean; // true for rate_limit, unavailable, timeout
}
```

Only `llm.ts` imports a provider, and only `llm/gemini.ts` imports `@google/genai`. Prompts, schemas, parsing, clamping, budgets, routes and route tests sit above the boundary and do not change when the provider does. Swapping to Anthropic or OpenAI later is one new file under `src/lib/llm/` plus a new `LLM_PROVIDER` value. The Gemini provider uses the Interactions API (`ai.interactions.create`), which the docs now present as primary; `generateContent` is legacy but still supported.

## Components (`src/components`, plus `src/hooks/useMatchPipeline.ts`)

| Component                        | Role                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BriefForm`                      | 3 required text inputs, 4 selects with defaults, optional notes, submit. Client-side `Brief.safeParse` for inline errors. Disabled while running                                                  |
| `ExampleButtons`                 | 3 buttons from `/api/status`. Fill the form and submit in one click. "Precomputed" badge on results                                                                                               |
| `PipelineStatus`                 | Three steps (queries, search, scoring) with idle/running/done/error and elapsed ms. Shows the generated queries                                                                                   |
| `CreatorGrid`                    | Responsive grid, ordered by rank, re-sorted by `fitScore` once all scores arrive                                                                                                                  |
| `CreatorCard`                    | Thumbnail, title, handle, subscribers, videos, matched video titles, link. Score area: skeleton → fit badge, verdict, reasons, concerns. "Retry" on a retryable error                             |
| `OutreachPanel`                  | Inside a card: angle, subject line, opening message, copy buttons                                                                                                                                 |
| `QuotaBanner`                    | "2 of 3 live searches left today", budget low/exhausted message pointing at the examples, "passcode active"                                                                                       |
| `PasscodeDialog`                 | Footer link "Have a passcode?" opens a small form posting to `/api/passcode`                                                                                                                      |
| `useMatchPipeline`               | State machine idle → brief → search → scoring → done. Runs the three calls, reads the score stream with `readNdjson`, keeps per-card state, maps error codes to messages, supports per-card retry |
| `app/page.tsx`, `app/layout.tsx` | Single page: header line, form, banner, status, grid, footer                                                                                                                                      |

## Testing strategy

Vitest, `environment: node`. Unit tests sit next to their module (`*.test.ts`). Route tests sit next to each route (`route.test.ts`) and call the exported `POST` with a `new Request(...)` carrying `content-type`, `x-forwarded-for`, and optionally `cookie`. No network, no Next request context.

Shared test code in `src/test/`:

- `setup.ts` - resets the memory cache, clears env stubs, fixes the clock.
- `fixtures.ts` - a brief, a `QueryPlan`, YouTube search and channel payloads, a `CreatorScore`.
- `mocks.ts` - `mockGemini(createImpl)` via `vi.mock("@google/genai")` with a fake `GoogleGenAI` whose `interactions.create` is a `vi.fn()`, so `llm/gemini.ts` and `llm.ts` logic (error mapping, invalid JSON re-ask, batching, semaphore, request counting) is exercised; `mockYouTube({ search, channels })` via `vi.mock("@/lib/youtube")`. `youtube.test.ts` separately stubs global `fetch` to cover unit accounting and the `quotaExceeded` mapping.

| Route         | Cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/brief`  | happy path (200, 16-char id, 3 queries, one Gemini request, `llm:requests` +1); cached (second call, no Gemini request); invalid body (400); safety block (502 `llm_error`, `retryable: false`); invalid JSON then valid (one re-ask, 200); 429 after retries (502 `llm_error`, `retryable: true`); LLM budget spent (503 `budget_exhausted`)                                                                                                                                                                    |
| `/api/search` | happy path (200, ≤ 10 creators, searches +3, units +1, visitor +1); cached (no counters change); visitor limit (preset counter 3 → 429; with passcode cookie → 200); budget exhausted (preset searches 60 → 503; with passcode → 200; at 95 → 503); unknown brief (404)                                                                                                                                                                                                                                          |
| `/api/score`  | happy path (10 ids produce exactly 2 Gemini requests, stream has one `score` line per id plus `done`; max in-flight never exceeds `LLM_CONCURRENCY`, asserted by counting inside the mock); cached line without an LLM request; `score_cap` error lines when the counter is at max; safety block → `error` lines for that batch, `retryable: false`, counter unchanged; 429 after retries → `error` lines, `retryable: true`; a creator missing from the batch result → single `error` line; unknown brief (404) |

Pure-logic unit tests: `hash` (stable ids across key order and whitespace), `pipeline` (filter and rank), `rate-limit` (buckets and thresholds on the memory store), `semaphore`, `schemas` (fixtures parse, clamp).

## Risks and mitigations

1. **Quota burn.** 100 searches/day is tiny. Per-query 7 d cache, `MAX_QUERIES` 3, visitor limit, search budget with public and passcode thresholds checked before every call, examples cost nothing. If Redis is unreachable in production, live search fails closed with `budget_exhausted`.
2. **Latency over 20 s.** Gemini 3.5 Flash-Lite with low thinking for both calls, parallel searches, two score batches in parallel, cards before scores. Log each stage from step 8 onward and record timings in BUILD_LOG.md. If scoring misses the budget, try `LLM_SCORE_BATCH_SIZE=10` (one request, no second wave).
3. **Gemini free-tier limits.** Requests per minute and per day are not published in the docs; they appear per project in AI Studio and change without notice (this project on 2026-10-05: 15 per minute and 500 per day for 3.5 Flash-Lite, 20 per day for every Flash model). Mitigations: concurrency 2, batched scoring (3 requests per fresh brief), the SDK's own backoff on 429 and 5xx, a daily request counter that fails closed with `budget_exhausted`, retryable errors surfacing as a per-card "Retry", and model ids in env so a model with a better quota is a redeploy away. The semaphore is per function instance; under Fluid compute concurrent requests share instances, which is enough for v1.
4. **Weak relevance from YouTube search.** Search videos and aggregate channels; prompt for viewer phrasing, not brand copy. Subscriber filter and hits weighting dampen off-topic mega-channels.
5. **Structured output limits.** Gemini accepts a JSON Schema subset, and the output is text, not a parsed object. LLM-facing schemas use objects, arrays, strings, numbers, enums and descriptions, no optional, nullable or union fields; `$schema` is stripped from `z.toJSONSchema()` output. Text is `JSON.parse`d then Zod-validated; a failure gets one re-ask, then a per-card error, never a whole-page failure.
6. **Abuse and cost with no auth.** Per-IP limits, `scorecount` cap, output token caps, input length caps, YouTube key restricted to the Data API. Gemini stays on the free tier with no billing attached, so the worst case is a 429, not a bill.
7. **Shared IPs.** Offices and carriers share the 3-search limit. Acceptable for v1; the passcode is the escape hatch for demos.
8. **Quota day boundary.** Both YouTube buckets reset at midnight Pacific; counter keys use the Pacific date.
9. **Stale examples.** Precomputed JSON drifts from live stats. Label with `precomputedAt`. Re-run `npm run precompute` after changing normalization, schemas, or prompts, since `briefId` must still match.
10. **Streaming on Vercel.** Route handlers returning a `ReadableStream` do stream on the Node runtime. If a proxy buffers, the UI still works, it just fills in all at once.
11. **Free-tier data use.** Google may use free-tier prompts and outputs to improve its products. Briefs are marketing copy and the YouTube data is public, so this is acceptable for a demo; the footer says so, and nothing confidential should be pasted.
12. **Model churn.** Gemini ids move fast (3.5, 3.7 and 3.8 Flash shipped within months) and older ones are shut down. Model ids live in env, never in code, and `-latest` aliases are avoided because they change underneath a deployed app.

## Build order

Each step ends with something you can run. From step 2 on, each step also ends with: `npm run lint && npm run typecheck && npm test`, commit, push to `main`, Vercel auto-deploys, check the live URL, append an entry to `BUILD_LOG.md`.

1. **Scaffold.** `npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --use-npm --import-alias "@/*"`. Add Prettier, Vitest, `tsx`, `zod`, `@upstash/redis` (the LLM SDK, `@google/genai`, is added in step 6; the scaffold originally installed `@anthropic-ai/sdk`, which step 6 removes). Scripts from CLAUDE.md, `.env.example`, one trivial test, `README.md` stub (what it is, how to run), `BUILD_LOG.md` with the step-1 entry. Run: `npm run dev` shows the placeholder; lint, typecheck, test pass.
2. **GitHub and Vercel.** `git init`, first commit, `gh repo create creator-match --private --source=. --push`. Import the repo in Vercel, leave env vars empty for now, deploy. Run: the live URL shows the placeholder page.
3. **Schemas, config, hashing, errors.** `schemas.ts`, `config.ts`, `hash.ts`, `errors.ts`, `semaphore.ts` with unit tests. Run: `npm test`.
4. **Cache layer and status route.** `cache.ts` (memory + Upstash), `GET /api/status` reporting `store`. Add Upstash for Redis from the Vercel Marketplace (injects `KV_REST_API_*`), redeploy. Run: local `/api/status` says `memory`, live says `redis`.
5. **Brief form.** `BriefForm`, `ExampleButtons` with three hard-coded briefs, client validation, submit logs the parsed brief. Run: fill the form locally and live, see the parsed object in the console.
6. **Query generation (Gemini).** Provider switch first: `npm uninstall @anthropic-ai/sdk && npm install @google/genai`, rename `claude_error` to `llm_error`, replace the `CLAUDE_*` and `SCORE_CONCURRENCY` env with the `LLM_*` set in `config.ts` and its tests. Then `llm/provider.ts`, `llm/gemini.ts`, `llm.ts` (`generateQueries`), `prompts.ts`, `POST /api/brief`, `PipelineStatus` showing queries. Route tests for `/api/brief` with `@google/genai` mocked. Add `GEMINI_API_KEY` locally and in Vercel. Run: submit a brief, read three queries; resubmit and see `cached: true`; same on the live URL; `llm:requests` counter visible in the log line.
7. **YouTube search and cards.** `youtube.ts` with counters, `pipeline.ts` with ranking tests, `rate-limit.ts` search budget, `POST /api/search`, `CreatorGrid`, `CreatorCard` without score area, `useMatchPipeline` for steps 1 and 2. Route tests for `/api/search` (happy, cached, budget exhausted, 404) plus `youtube.test.ts`. Add `YOUTUBE_API_KEY` locally and in Vercel. Run: brief → up to 10 cards in under 8 s; second run spends 0 searches (check the log and live `/api/status`).
8. **Scoring.** `scoreCreators` in batches of `LLM_SCORE_BATCH_SIZE` behind the semaphore, `ndjson.ts`, streaming `POST /api/score`, client stream reader, score area on cards, `OutreachPanel` with copy buttons. Route tests for `/api/score` (2 requests for 10 ids with the concurrency assertion, cached, score cap, safety block, 429, skipped creator). Run: full flow locally and live; record stage timings and Gemini request counts in BUILD_LOG.md; total under 20 s.
9. **Visitor limits and banner.** Visitor counters in `/api/brief` and `/api/search`, `QuotaBanner`, error states and per-card retry in the hook. Route tests for visitor limit. Run: set `VISITOR_SEARCH_LIMIT=1` locally, run two fresh briefs, see the 429 banner; live, confirm the banner counts down.
10. **Passcode.** `access.ts`, `POST/DELETE /api/passcode`, `PasscodeDialog`, bypass wired into the limiter. Tests for bypass. Add `DEMO_PASSCODE` in Vercel. Run: enter the passcode live, banner shows "passcode active", limit no longer trips.
11. **Precomputed examples.** `scripts/precompute-examples.ts` runs the lib functions directly for three briefs and writes `data/examples/*.json`; `examples.ts` read-through; `budget_exhausted` fallback UI. Run: `npm run precompute`, restart dev, click an example with API keys removed from `.env.local` and get full results; live, click an example and confirm `/api/status` counters do not move.
12. **Polish only.** Skeletons, mobile layout, favicon, footer, README final pass (live link, how it works, limits), BUILD_LOG summary with final timings. Run: live URL end to end on a phone.
13. **Optional.** `videos.list` for matched-video view counts; share link `?b={briefId}`; CSV export.

## Documents to keep current

- `README.md` - what it is, live link, how the pipeline works, limits and why, local setup, env vars, deploy, precompute. Stub in step 1, complete in step 12.
- `BUILD_LOG.md` - one dated entry per step: what was built, how it was verified (local and live), timings observed, surprises and decisions. Appended at the end of every step.

## Example briefs (fictional, for `scripts/precompute-examples.ts`)

| Slug             | Brand          | Product                                               | Audience                                        | Goal         | Range    | Region/lang |
| ---------------- | -------------- | ----------------------------------------------------- | ----------------------------------------------- | ------------ | -------- | ----------- |
| `peak-fuel`      | Peak Fuel      | Electrolyte drink mix for long-distance runners       | Amateur marathon and half-marathon runners      | awareness    | 10k-100k | US / en     |
| `loomnotes`      | LoomNotes      | AI note-taking app that turns lectures into summaries | University students juggling lectures and exams | app_installs | 10k-100k | any / en    |
| `terra-cookware` | Terra Cookware | Ceramic non-stick pans for weeknight batch cooking    | Home cooks who meal-prep on Sundays             | conversions  | 100k-1m  | GB / en     |
