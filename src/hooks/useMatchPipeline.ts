"use client";

import { useCallback, useRef, useState } from "react";
import type { BriefSource } from "@/components/BriefForm";
import { readNdjson } from "@/lib/ndjson";
import type {
  Brief,
  BriefResponse,
  BudgetState,
  Creator,
  CreatorScore,
  ErrorResponse,
  QueryPlan,
  ScoreLine,
  SearchResponse,
  VisitorStatus,
} from "@/lib/schemas";

export type Stage = "idle" | "brief" | "search" | "score" | "done" | "error";

export interface PipelineError {
  code: string;
  message: string;
  retryable: boolean;
}

export type ScoreStatus =
  | { status: "pending" }
  | { status: "done"; score: CreatorScore; cached: boolean }
  | { status: "error"; error: PipelineError };

export interface PipelineState {
  stage: Stage;
  /** Whether the run started from the form or an example button. */
  source: BriefSource;
  /** Which stage failed when stage is "error". */
  failedStage: "brief" | "search" | "score" | null;
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
  scores: Record<string, ScoreStatus>;
  scoreMs: number | null;
  scoreSummary: { scored: number; failed: number } | null;
  error: PipelineError | null;
}

const INITIAL: PipelineState = {
  stage: "idle",
  source: "form",
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
  scores: {},
  scoreMs: null,
  scoreSummary: null,
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
        : "The AI service could not produce a usable answer here. Try rewording the brief.";
    case "youtube_error":
      return error.retryable
        ? "YouTube did not answer. Try again in a moment."
        : "YouTube rejected the search. This needs a fix on our side.";
    case "visitor_limit":
      return "You have used today's live searches. The example briefs still work.";
    case "score_cap":
      return "This brief has reached its scoring cap.";
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

const NETWORK_ERROR: PipelineError = {
  code: "network",
  message: "Could not reach the server. Check your connection and try again.",
  retryable: true,
};

function toPipelineError(error: ErrorResponse["error"]): PipelineError {
  return {
    code: error.code,
    message: friendlyError(error),
    retryable: Boolean(error.retryable),
  };
}

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
    return { ok: false, ms: ms(), error: NETWORK_ERROR };
  }
  if (!res.ok) {
    return {
      ok: false,
      ms: ms(),
      error: toPipelineError((parsed as ErrorResponse).error),
    };
  }
  return { ok: true, data: parsed as T, ms: ms() };
}

/**
 * Runs the pipeline for one brief: queries, YouTube search, then streamed
 * scores. A new run cancels the effects of an older one.
 */
export function useMatchPipeline() {
  const [state, setState] = useState<PipelineState>(INITIAL);
  const runId = useRef(0);

  /** Streams scores for `channelIds` into state. Returns false if the request itself failed. */
  const streamScores = useCallback(
    async (briefId: string, channelIds: string[], id: number) => {
      const current = () => id === runId.current;
      setState((s) => ({
        ...s,
        scores: {
          ...s.scores,
          ...Object.fromEntries(
            channelIds.map((c) => [c, { status: "pending" }]),
          ),
        },
      }));
      let res: Response;
      try {
        res = await fetch("/api/score", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ briefId, channelIds }),
        });
      } catch {
        return NETWORK_ERROR;
      }
      if (!res.ok) {
        let error: PipelineError = NETWORK_ERROR;
        try {
          error = toPipelineError(((await res.json()) as ErrorResponse).error);
        } catch {
          /* keep the network wording */
        }
        return error;
      }
      let summary: { scored: number; failed: number } | null = null;
      try {
        await readNdjson<ScoreLine>(res, (line) => {
          if (!current()) return;
          if (line.type === "score") {
            setState((s) => ({
              ...s,
              scores: {
                ...s.scores,
                [line.channelId]: {
                  status: "done",
                  score: line.score,
                  cached: line.cached,
                },
              },
            }));
          } else if (line.type === "error") {
            setState((s) => ({
              ...s,
              scores: {
                ...s.scores,
                [line.channelId]: {
                  status: "error",
                  error: toPipelineError({
                    code: line.code,
                    message: line.message,
                    retryable: line.retryable,
                  }),
                },
              },
            }));
          } else {
            summary = { scored: line.scored, failed: line.failed };
          }
        });
      } catch {
        return NETWORK_ERROR;
      }
      return summary ?? null;
    },
    [],
  );

  const run = useCallback(
    async (brief: Brief, source: BriefSource = "form") => {
      const id = ++runId.current;
      const current = () => id === runId.current;
      setState({ ...INITIAL, stage: "brief", brief, source });

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
      const { creators, budget, visitor } = searchOutcome.data;
      setState((s) => ({
        ...s,
        stage: creators.length > 0 ? "score" : "done",
        creators,
        searchCached: searchOutcome.data.cached,
        searchMs: searchOutcome.ms,
        budget,
        visitor,
      }));
      if (creators.length === 0) return;

      const started = performance.now();
      const result = await streamScores(
        briefId,
        creators.map((c) => c.channelId),
        id,
      );
      if (!current()) return;
      const scoreMs = Math.round(performance.now() - started);
      if (result && "code" in result) {
        setState((s) => ({
          ...s,
          stage: "error",
          failedStage: "score",
          scoreMs,
          error: result,
          scores: Object.fromEntries(
            Object.entries(s.scores).map(([k, v]) => [
              k,
              v.status === "pending" ? { status: "error", error: result } : v,
            ]),
          ),
        }));
        return;
      }
      setState((s) => ({ ...s, stage: "done", scoreMs, scoreSummary: result }));
    },
    [streamScores],
  );

  /** Re-scores one channel after a retryable failure. */
  const retryScore = useCallback(
    async (channelId: string) => {
      const briefId = state.briefId;
      if (!briefId) return;
      await streamScores(briefId, [channelId], runId.current);
    },
    [state.briefId, streamScores],
  );

  const reset = useCallback(() => {
    runId.current += 1;
    setState(INITIAL);
  }, []);

  const busy =
    state.stage === "brief" ||
    state.stage === "search" ||
    state.stage === "score";
  return { state, run, retryScore, reset, busy };
}
