import type { ZodError } from "zod";
import type { ErrorCode, ErrorResponse } from "./schemas";

export const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  not_found: 404,
  visitor_limit: 429,
  budget_exhausted: 503,
  score_cap: 429,
  youtube_error: 502,
  claude_error: 502,
  forbidden: 403,
  internal: 500,
};

export interface AppErrorOptions {
  status?: number;
  retryable?: boolean;
  cause?: unknown;
}

/** The only error type routes map to a response. Everything else is `internal`. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(
      message,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? ERROR_STATUS[code];
    this.retryable = options.retryable ?? false;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function formatZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return `${path || "(root)"}: ${issue.message}`;
    })
    .join("; ");
}

export function fromZodError(
  error: ZodError,
  code: ErrorCode = "invalid_request",
): AppError {
  return new AppError(code, formatZodIssues(error), { cause: error });
}

/** Serializes any thrown value as an ErrorResponse with the right status. */
export function toErrorResponse(error: unknown): Response {
  let appError: AppError;
  if (isAppError(error)) {
    appError = error;
  } else {
    console.error("Unhandled error", error);
    appError = new AppError("internal", "Unexpected server error");
  }
  const body: ErrorResponse = {
    error: { code: appError.code, message: appError.message },
  };
  return new Response(JSON.stringify(body), {
    status: appError.status,
    headers: { "content-type": "application/json" },
  });
}
