import { z } from "zod";
import { getConfig, LIMITS } from "./config";
import { AppError, formatZodIssues } from "./errors";
import { createGeminiProvider } from "./llm/gemini";
import {
  LlmError,
  type LlmProvider,
  type StructuredRequest,
  type ThinkingLevel,
} from "./llm/provider";
import {
  QUERY_SYSTEM_PROMPT,
  REASK_SUFFIX,
  SCORE_SYSTEM_PROMPT,
  queryPrompt,
  scorePrompt,
} from "./prompts";
import { reserveLlmRequest } from "./rate-limit";
import {
  CreatorScoreBatch,
  QueryPlan,
  clampFitScore,
  type Brief,
  type Creator,
  type CreatorScore,
} from "./schemas";
import { Semaphore } from "./semaphore";

let provider: LlmProvider | null = null;
let semaphore: Semaphore | null = null;

/** The configured provider, built once per process. */
export function getProvider(): LlmProvider {
  if (provider) return provider;
  const config = getConfig();
  if (config.LLM_PROVIDER !== "gemini") {
    throw new AppError(
      "internal",
      `Unknown LLM provider: ${config.LLM_PROVIDER}`,
    );
  }
  if (!config.GEMINI_API_KEY) {
    throw new AppError("internal", "GEMINI_API_KEY is not set");
  }
  provider = createGeminiProvider({
    apiKey: config.GEMINI_API_KEY,
    maxRetries: config.LLM_MAX_RETRIES,
    timeoutMs: config.LLM_TIMEOUT_MS,
  });
  return provider;
}

/** Tests only: inject a fake provider instead of reading the environment. */
export function setProvider(next: LlmProvider | null): void {
  provider = next;
}

/** Tests only: drop the provider and semaphore so the next call re-reads env. */
export function resetLlm(): void {
  provider = null;
  semaphore = null;
}

function getSemaphore(): Semaphore {
  if (!semaphore) semaphore = new Semaphore(getConfig().LLM_CONCURRENCY);
  return semaphore;
}

/** JSON Schema for the provider. Zod adds a "$schema" key that Gemini does not accept. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

type Parsed<T> = { ok: true; data: T } | { ok: false; reason: string };

function tryParse<T>(schema: z.ZodType<T>, text: string): Parsed<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFences(text));
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  const result = schema.safeParse(raw);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, reason: formatZodIssues(result.error) };
}

/** Turns provider failures into the one error shape routes understand. */
export function mapLlmError(error: unknown, label: string): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof LlmError) {
    return new AppError("llm_error", `${label}: ${error.message}`, {
      retryable: error.retryable,
      cause: error,
    });
  }
  return new AppError("llm_error", `${label}: unexpected LLM failure`, {
    retryable: true,
    cause: error,
  });
}

async function callProvider(
  llm: LlmProvider,
  request: StructuredRequest,
  label: string,
): Promise<string> {
  await reserveLlmRequest();
  try {
    return (await llm.complete(request)).text;
  } catch (error) {
    throw mapLlmError(error, label);
  }
}

export interface JsonCallOptions {
  model: string;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  thinking?: ThinkingLevel;
  /** Names the call in errors and logs, e.g. "generateQueries". */
  label: string;
}

/**
 * One structured call: budget, semaphore, provider, parse, validate. Invalid
 * output gets exactly one re-ask, then a non-retryable llm_error.
 */
export async function completeJson<T>(
  schema: z.ZodType<T>,
  options: JsonCallOptions,
): Promise<T> {
  const config = getConfig();
  const llm = getProvider();
  const request: StructuredRequest = {
    model: options.model,
    system: options.system,
    prompt: options.prompt,
    schema: toJsonSchema(schema),
    maxOutputTokens: options.maxOutputTokens,
    thinking: options.thinking ?? "low",
    timeoutMs: config.LLM_TIMEOUT_MS,
  };
  return getSemaphore().run(async () => {
    const first = tryParse(
      schema,
      await callProvider(llm, request, options.label),
    );
    if (first.ok) return first.data;
    const retry = {
      ...request,
      prompt: `${request.prompt}\n\n${REASK_SUFFIX}`,
    };
    const second = tryParse(
      schema,
      await callProvider(llm, retry, options.label),
    );
    if (second.ok) return second.data;
    throw new AppError(
      "llm_error",
      `${options.label}: the model returned invalid output twice (${second.reason})`,
      { retryable: false },
    );
  });
}

export async function generateQueries(brief: Brief): Promise<QueryPlan> {
  const config = getConfig();
  const plan = await completeJson(QueryPlan, {
    model: config.LLM_QUERY_MODEL,
    system: QUERY_SYSTEM_PROMPT,
    prompt: queryPrompt(brief),
    maxOutputTokens: 1024,
    thinking: "low",
    label: "generateQueries",
  });
  const queries = plan.queries
    .filter((q) => q.q.trim() !== "")
    .slice(0, LIMITS.MAX_QUERIES);
  if (queries.length === 0) {
    throw new AppError(
      "llm_error",
      "generateQueries: the model returned no queries",
      {
        retryable: true,
      },
    );
  }
  return { ...plan, queries };
}

/**
 * Scores one batch of creators in a single request. A channel the model
 * skipped is simply absent from the map; the caller decides what to do.
 */
export async function scoreCreators(
  brief: Brief,
  plan: QueryPlan,
  creators: Creator[],
): Promise<Map<string, CreatorScore>> {
  const config = getConfig();
  const batch = await completeJson(CreatorScoreBatch, {
    model: config.LLM_SCORE_MODEL,
    system: SCORE_SYSTEM_PROMPT,
    prompt: scorePrompt(brief, plan, creators),
    maxOutputTokens: 4096,
    thinking: "low",
    label: "scoreCreators",
  });
  const wanted = new Set(creators.map((c) => c.channelId));
  const scores = new Map<string, CreatorScore>();
  for (const entry of batch.scores) {
    if (!wanted.has(entry.channelId) || scores.has(entry.channelId)) continue;
    const { channelId, ...score } = entry;
    scores.set(channelId, clampFitScore(score));
  }
  return scores;
}
