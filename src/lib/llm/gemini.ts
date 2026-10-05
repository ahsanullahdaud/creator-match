import { ApiError, GoogleGenAI } from "@google/genai";
import {
  LlmError,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResult,
} from "./provider";

export interface GeminiOptions {
  apiKey: string;
  maxRetries: number;
  timeoutMs: number;
}

/** HTTP statuses the SDK retries with backoff before we see an error. */
const RETRY_CODES = ["408", "429", "500", "502", "503", "504"];

/**
 * Gemini over the Interactions API. The only file that imports @google/genai.
 * Field names are snake_case because that is the Interactions SDK surface.
 */
export function createGeminiProvider(options: GeminiOptions): LlmProvider {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  return {
    name: "gemini",

    async complete(request: StructuredRequest): Promise<StructuredResult> {
      let interaction;
      try {
        interaction = await ai.interactions.create(
          {
            model: request.model,
            input: request.prompt,
            system_instruction: request.system,
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: request.schema,
            },
            generation_config: {
              thinking_level: request.thinking,
              max_output_tokens: request.maxOutputTokens,
            },
          },
          {
            timeout: request.timeoutMs || options.timeoutMs,
            retries: {
              strategy: "attempt-count-backoff",
              maxRetries: options.maxRetries,
              backoff: {
                initialInterval: 1_000,
                maxInterval: 8_000,
                exponent: 2,
              },
            },
            retry_codes: RETRY_CODES,
          },
        );
      } catch (error) {
        throw toLlmError(error);
      }

      if (
        interaction.status === "failed" ||
        interaction.status === "cancelled"
      ) {
        const detail = (interaction.errors ?? [])
          .map((e) => e.message)
          .filter(Boolean)
          .join("; ");
        const suffix = detail ? `: ${detail}` : "";
        throw new LlmError(
          "blocked",
          `Gemini interaction ${interaction.status}${suffix}`,
        );
      }

      const text = interaction.output_text ?? "";
      if (text.trim() === "") {
        throw new LlmError(
          "blocked",
          interaction.status === "incomplete"
            ? "Gemini stopped before producing output (token cap or safety)"
            : "Gemini returned no text",
        );
      }

      return {
        text,
        usage: {
          inputTokens: interaction.usage?.total_input_tokens,
          outputTokens: interaction.usage?.total_output_tokens,
        },
      };
    },
  };
}

function extractStatus(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.status;
  if (typeof error === "object" && error !== null) {
    const candidate = error as { status?: unknown; statusCode?: unknown };
    if (typeof candidate.status === "number") return candidate.status;
    if (typeof candidate.statusCode === "number") return candidate.statusCode;
  }
  return undefined;
}

/** Maps whatever the SDK throws to an LlmError with a kind and retryable flag. */
export function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  const status = extractStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  const info = { status, cause: error };

  if (status === 429) {
    return new LlmError("rate_limit", `Gemini rate limit: ${message}`, info);
  }
  if (
    status === 408 ||
    name === "RequestTimeoutError" ||
    name === "RequestAbortedError" ||
    /timed? ?out|aborted/i.test(message)
  ) {
    return new LlmError(
      "timeout",
      `Gemini request timed out: ${message}`,
      info,
    );
  }
  if (status !== undefined && status >= 500) {
    return new LlmError(
      "unavailable",
      `Gemini unavailable (${status}): ${message}`,
      info,
    );
  }
  if (status !== undefined && status >= 400) {
    return new LlmError(
      "invalid_request",
      `Gemini rejected the request (${status}): ${message}`,
      info,
    );
  }
  return new LlmError("unavailable", `Gemini request failed: ${message}`, info);
}
