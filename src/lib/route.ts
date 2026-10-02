import { toErrorResponse } from "./errors";

export interface RouteContext {
  /** Extra fields for this request's log line, e.g. stage timings in ms. */
  log: Record<string, unknown>;
}

export type RouteHandler = (
  request: Request,
  ctx: RouteContext,
) => Promise<Response>;

/** JSON response. Never cached unless the caller says otherwise. */
export function json<T>(body: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * Wraps a route handler: maps thrown errors to ErrorResponse, forbids caching,
 * and writes one JSON log line per request with the status and duration.
 */
export function handle(
  route: string,
  handler: RouteHandler,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const started = Date.now();
    const ctx: RouteContext = { log: {} };
    let response: Response;
    try {
      response = await handler(request, ctx);
    } catch (error) {
      response = toErrorResponse(error);
    }
    if (!response.headers.has("cache-control")) {
      response.headers.set("cache-control", "no-store");
    }
    console.log(
      JSON.stringify({
        route,
        method: request.method,
        status: response.status,
        ms: Date.now() - started,
        ...ctx.log,
      }),
    );
    return response;
  };
}
