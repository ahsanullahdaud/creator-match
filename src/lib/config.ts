import { z } from "zod";
import { formatZodIssues } from "./errors";

/** Hard limits that are not tunable from the environment. */
export const LIMITS = {
  MAX_QUERIES: 3,
  MAX_CREATORS: 10,
  SEARCH_MAX_RESULTS: 50,
  MAX_CANDIDATES: 50,
  MATCHED_VIDEOS_PER_CREATOR: 3,
  MIN_VIDEO_COUNT: 5,
  YT_SEARCH_DAILY_CAP: 100, // search.list has its own bucket of 100 calls/day
  YT_UNIT_DAILY_CAP: 10_000, // channels.list and videos.list, 1 unit each
  LOW_BUDGET_THRESHOLD: 10, // "low" once fewer public searches remain today
  PASSCODE_ATTEMPTS_PER_DAY: 20,
} as const;

const HOUR = 3_600;
const DAY = 24 * HOUR;

/** Cache TTLs in seconds. Keys are listed in PLAN.md. */
export const TTL_SECONDS = {
  brief: 7 * DAY,
  search: 7 * DAY,
  score: 7 * DAY,
  scoreCount: 7 * DAY,
  ytSearch: 7 * DAY,
  ytChannel: 24 * HOUR,
  ytCounter: 48 * HOUR,
  llmCounter: 48 * HOUR,
  visitorBucket: 36 * HOUR,
} as const;

const EnvObject = z.object({
  GEMINI_API_KEY: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  KV_REST_API_URL: z.string().optional(),
  KV_REST_API_TOKEN: z.string().optional(),
  DEMO_PASSCODE: z.string().optional(),
  RATE_LIMIT_SALT: z.string().default("dev-salt"),
  LLM_PROVIDER: z.enum(["gemini"]).default("gemini"),
  LLM_QUERY_MODEL: z.string().default("gemini-3.5-flash-lite"),
  LLM_SCORE_MODEL: z.string().default("gemini-3.5-flash-lite"),
  LLM_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  LLM_SCORE_BATCH_SIZE: z.coerce.number().int().min(1).max(10).default(5),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(30_000),
  LLM_DAILY_REQUEST_BUDGET: z.coerce.number().int().min(0).default(450),
  VISITOR_SEARCH_LIMIT: z.coerce.number().int().min(0).default(3),
  VISITOR_BRIEF_LIMIT: z.coerce.number().int().min(0).default(10),
  YT_PUBLIC_SEARCH_BUDGET: z.coerce
    .number()
    .int()
    .min(0)
    .max(LIMITS.YT_SEARCH_DAILY_CAP)
    .default(60),
  YT_TOTAL_SEARCH_BUDGET: z.coerce
    .number()
    .int()
    .min(0)
    .max(LIMITS.YT_SEARCH_DAILY_CAP)
    .default(95),
});

const EnvSchema = EnvObject.refine(
  (c) => c.YT_PUBLIC_SEARCH_BUDGET <= c.YT_TOTAL_SEARCH_BUDGET,
  {
    message: "must not exceed YT_TOTAL_SEARCH_BUDGET",
    path: ["YT_PUBLIC_SEARCH_BUDGET"],
  },
);

export type Config = z.infer<typeof EnvSchema>;

const ENV_KEYS = Object.keys(EnvObject.shape);

type EnvSource = Record<string, string | undefined>;

/** Empty strings count as unset, so a copied .env.example falls back to defaults. */
function readEnv(env: EnvSource): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (value !== undefined && value.trim() !== "") out[key] = value.trim();
  }
  return out;
}

/**
 * Reads the environment on every call (no memo), so tests can stub variables
 * and route handlers always see the current values.
 */
export function getConfig(env: EnvSource = process.env): Config {
  const result = EnvSchema.safeParse(readEnv(env));
  if (!result.success) {
    throw new Error(`Invalid environment: ${formatZodIssues(result.error)}`);
  }
  return result.data;
}

export function hasRedis(config: Config): boolean {
  return Boolean(config.KV_REST_API_URL && config.KV_REST_API_TOKEN);
}
