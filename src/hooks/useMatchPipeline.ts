"use client";

import { useCallback, useRef, useState } from "react";
import type {
  Brief,
  BriefResponse,
  ErrorResponse,
  QueryPlan,
} from "@/lib/schemas";

export type Stage = "idle" | "brief" | "done" | "error";

export interface PipelineError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface PipelineState {
  stage: Stage;
  brief: Brief | null;
  briefId: string | null;
  queries: QueryPlan | null;
  cached: boolean;
  briefMs: number | null;
  error: PipelineError | null;
}

const INITIAL: PipelineState = {
  stage: "idle",
  brief: null,
  briefId: null,
  queries: null,
  cached: false,
  briefMs: null,
  error: null,
};

/** Human wording for every error code a route can return. */
export function friendlyError(error: ErrorResponse["error"]): string {
  switch (error.code) {
    case "budget_exhausted":
      return "Today's AI request budget is used up. Try one of the example briefs, or come back tomorrow.";
    case "llm_error":
      return error.retryable
        ? "The AI service is busy right now. Try again in a moment."
        : "The AI service could not produce a usable answer for this brief. Try rewording it.";
    case "visitor_limit":
      return "You have used today's live searches. The example briefs still work.";
    case "invalid_request":
      return error.message;
    default:
      return "Something went wrong on our side. Try again.";
  }
}

/**
 * Runs the pipeline for one brief. Step 6 covers the query stage; search and
 * scoring arrive in steps 7 and 8.
 */
export function useMatchPipeline() {
  const [state, setState] = useState<PipelineState>(INITIAL);
  const runId = useRef(0);

  const run = useCallback(async (brief: Brief) => {
    const id = ++runId.current;
    setState({ ...INITIAL, stage: "brief", brief });
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    let res: Response;
    let body: unknown;
    try {
      res = await fetch("/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(brief),
      });
      body = await res.json();
    } catch {
      if (id !== runId.current) return;
      setState((s) => ({
        ...s,
        stage: "error",
        briefMs: elapsed(),
        error: {
          code: "network",
          message:
            "Could not reach the server. Check your connection and try again.",
          retryable: true,
        },
      }));
      return;
    }
    if (id !== runId.current) return;

    if (!res.ok) {
      const { error } = body as ErrorResponse;
      setState((s) => ({
        ...s,
        stage: "error",
        briefMs: elapsed(),
        error: {
          code: error.code,
          message: friendlyError(error),
          retryable: Boolean(error.retryable),
        },
      }));
      return;
    }

    const data = body as BriefResponse;
    setState((s) => ({
      ...s,
      stage: "done",
      briefId: data.briefId,
      queries: data.queries,
      cached: data.cached,
      briefMs: elapsed(),
    }));
  }, []);

  const reset = useCallback(() => {
    runId.current += 1;
    setState(INITIAL);
  }, []);

  return { state, run, reset, busy: state.stage === "brief" };
}
