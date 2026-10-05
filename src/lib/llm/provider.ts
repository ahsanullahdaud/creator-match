/**
 * The boundary between the app and any LLM vendor. Nothing above this file
 * imports a vendor SDK; a new provider is one file implementing LlmProvider.
 */

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface StructuredRequest {
  model: string;
  /** System instruction. */
  system: string;
  /** User content. */
  prompt: string;
  /** JSON Schema from z.toJSONSchema, with "$schema" removed. */
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  thinking: ThinkingLevel;
  timeoutMs: number;
}

export interface StructuredResult {
  /** JSON text. The caller parses and validates it. */
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface LlmProvider {
  readonly name: string;
  complete(request: StructuredRequest): Promise<StructuredResult>;
}

export type LlmErrorKind =
  | "rate_limit" // 429 after the SDK's retries
  | "unavailable" // 5xx or connection failure after retries
  | "timeout"
  | "blocked" // safety block, failed interaction, or empty output
  | "invalid_request"; // 400/403/404: bad key, model, or schema

const RETRYABLE: Record<LlmErrorKind, boolean> = {
  rate_limit: true,
  unavailable: true,
  timeout: true,
  blocked: false,
  invalid_request: false,
};

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    kind: LlmErrorKind,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "LlmError";
    this.kind = kind;
    this.retryable = RETRYABLE[kind];
    this.status = options.status;
  }
}
