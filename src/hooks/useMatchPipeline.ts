"use client";

import { useCallback, useRef, useState } from "react";
import type {
  Brief,
  BriefResponse,
  BudgetState,
  Creator,
  ErrorResponse,
  QueryPlan,
  SearchResponse,
  VisitorStatus,
} from "@/lib/schemas";

export type Stage = "idle" | "brief" | "search" | "done" | "error";

export interface PipelineError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface PipelineState {
  stage: Stage;
  /** Which stage failed when stage is "error". */
  failedStage: "brief" | "search" | null;
  brief: Brief | null;
  briefId: string | null;
  queries: QueryPlan | null;
  briefCached: boolean;
  briefMs: number | null;
  creators: Creator[] | null;
  searchCached: boolean;
  searchMs: number | null;
  budget: BudgetState | null;
  visitor: VisitorStatus | null;
  error: PipelineError | null;
}

const INITIAL: PipelineState = {
  stage: "idle",
  failedStage: null,
  brief: null,
  briefId: null,
  queries: null,
  briefCached: false,
  briefMs: null,
  creators: null,
  searchCached: false,
  searchMs: null,
  budget: null,
  visitor: null,
  error: null,
};

/** Human wording for every error code a route can return. */
export function friendlyError(error: ErrorResponse["error"]): string {
  switch (error.code) {
    case "budget_exhausted":
      return error.message.includes("search")
        ? "Today's live search budget is used up. Try one of the example briefs, or come back tomorrow."
        : "Today's AI request budget is used up. Try one of the example briefs, or come back tomorrow.";
    case "llm_error":
      return error.retryable
        ? "The AI service is busy right now. Try again in a moment."
        : "The AI service could not produce a usable answer for this brief. Try rewording it.";
    case "youtube_error":
      return error.retryable
        ? "YouTube did not answer. Try again in a moment."
        : "YouTube rejected the search. This needs a fix on our side.";
    case "visitor_limit":
      return "You have used today's live searches. The example briefs still work.";
    case "not_found":
      return "That brief expired. Submit it again.";
    case "invalid_request":
      return error.message;
    default:
      return "Something went wrong on our side. Try again.";
  }
}

type Outcome<T> =
  | { ok: true; data: T; ms: number }
  | { ok: false; error: PipelineError; ms: number };

async function postJson<T>(url: string, body: unknown): Promise<Outcome<T>> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  let res: Response;
  let parsed: unknown;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    parsed = await res.json();
  } catch {
    return {
      ok: false,
      ms: ms(),
      error: {
        code: "network",
        message:
          "Could not reach the server. Check your connection and try again.",
        retryable: true,
      },
    };
  }
  if (!res.ok) {
    const { error } = parsed as ErrorResponse;
    return {
      ok: false,
      ms: ms(),
      error: {
        code: error.code,
        message: friendlyError(error),
        retryable: Boolean(error.retryable),
      },
    };
  }
  return { ok: true, data: parsed as T, ms: ms() };
}

/**
 * Runs the pipeline for one brief: queries, then YouTube search. Scoring
 * arrives in step 8. A new run cancels the effects of an older one.
 */
export function useMatchPipeline() {
  const [state, setState] = useState<PipelineState>(INITIAL);
  const runId = useRef(0);

  const run = useCallback(async (brief: Brief) => {
    const id = ++runId.current;
    const current = () => id === runId.current;
    setState({ ...INITIAL, stage: "brief", brief });

    const briefOutcome = await postJson<BriefResponse>("/api/brief", brief);
    if (!current()) return;
    if (!briefOutcome.ok) {
      setState((s) => ({
        ...s,
        stage: "error",
        failedStage: "brief",
        briefMs: briefOutcome.ms,
        error: briefOutcome.error,
      }));
      return;
    }
    const { briefId, queries, cached } = briefOutcome.data;
    setState((s) => ({
      ...s,
      stage: "search",
      briefId,
      queries,
      briefCached: cached,
      briefMs: briefOutcome.ms,
    }));

    const searchOutcome = await postJson<SearchResponse>("/api/search", {
      briefId,
    });
    if (!current()) return;
    if (!searchOutcome.ok) {
      setState((s) => ({
        ...s,
        stage: "error",
        failedStage: "search",
        searchMs: searchOutcome.ms,
        error: searchOutcome.error,
      }));
      return;
    }
    setState((s) => ({
      ...s,
      stage: "done",
      creators: searchOutcome.data.creators,
      searchCached: searchOutcome.data.cached,
      searchMs: searchOutcome.ms,
      budget: searchOutcome.data.budget,
      visitor: searchOutcome.data.visitor,
    }));
  }, []);

  const reset = useCallback(() => {
    runId.current += 1;
    setState(INITIAL);
  }, []);

  const busy = state.stage === "brief" || state.stage === "search";
  return { state, run, reset, busy };
}
