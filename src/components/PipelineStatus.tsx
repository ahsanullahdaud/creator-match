"use client";

import type { PipelineState } from "@/hooks/useMatchPipeline";

type StepState = "idle" | "running" | "done" | "error";

interface Step {
  key: string;
  label: string;
  state: StepState;
  detail?: string;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function steps(state: PipelineState): Step[] {
  const failed = state.stage === "error" ? state.failedStage : null;

  const brief: StepState =
    state.stage === "brief"
      ? "running"
      : failed === "brief"
        ? "error"
        : state.queries
          ? "done"
          : "idle";
  const briefDetail =
    brief === "running"
      ? "asking the AI for search queries"
      : brief === "done" && state.briefMs !== null
        ? `${state.briefCached ? "from cache" : "generated"} in ${state.briefMs} ms`
        : undefined;

  const search: StepState =
    state.stage === "search"
      ? "running"
      : failed === "search"
        ? "error"
        : state.creators
          ? "done"
          : "idle";
  const searchDetail =
    search === "running"
      ? "searching YouTube"
      : search === "done" && state.creators
        ? `${plural(state.creators.length, "channel")} ${
            state.searchCached ? "from cache" : "found"
          } in ${state.searchMs} ms`
        : undefined;

  const total = state.creators?.length ?? 0;
  const settled = Object.values(state.scores).filter(
    (s) => s.status !== "pending",
  ).length;
  const score: StepState =
    state.stage === "score"
      ? "running"
      : failed === "score"
        ? "error"
        : state.scoreSummary
          ? "done"
          : "idle";
  const scoreDetail =
    score === "running"
      ? `scoring ${plural(total, "channel")}, ${settled} done`
      : score === "done" && state.scoreSummary
        ? `${state.scoreSummary.scored} scored${
            state.scoreSummary.failed
              ? `, ${state.scoreSummary.failed} failed`
              : ""
          } in ${state.scoreMs} ms`
        : score === "idle" && state.stage === "done"
          ? "nothing to score"
          : undefined;

  return [
    {
      key: "brief",
      label: "Search queries",
      state: brief,
      detail: briefDetail,
    },
    {
      key: "search",
      label: "YouTube search",
      state: search,
      detail: searchDetail,
    },
    { key: "score", label: "Fit scores", state: score, detail: scoreDetail },
  ];
}

const dotClass: Record<StepState, string> = {
  idle: "bg-zinc-300 dark:bg-zinc-700",
  running: "bg-amber-400 animate-pulse",
  done: "bg-emerald-500",
  error: "bg-red-500",
};

/** The pipeline stages, the generated queries, and any error. */
export function PipelineStatus({ state }: { state: PipelineState }) {
  if (state.stage === "idle") return null;

  const totalMs =
    state.stage === "done"
      ? (state.briefMs ?? 0) + (state.searchMs ?? 0) + (state.scoreMs ?? 0)
      : null;

  return (
    <section
      aria-live="polite"
      className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps(state).map((step) => (
          <li key={step.key} className="flex items-start gap-2.5">
            <span
              aria-hidden
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass[step.state]}`}
            />
            <div className="flex flex-col">
              <span
                className={`text-sm font-medium ${
                  step.state === "idle"
                    ? "text-zinc-400 dark:text-zinc-600"
                    : "text-zinc-900 dark:text-zinc-100"
                }`}
              >
                {step.label}
              </span>
              {step.detail && (
                <span className="text-xs text-zinc-500">{step.detail}</span>
              )}
            </div>
          </li>
        ))}
      </ol>

      {totalMs !== null && (
        <p className="text-xs text-zinc-500">
          Total {(totalMs / 1000).toFixed(1)} s. Cards are ordered by fit score.
        </p>
      )}

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          {state.error.message}
        </p>
      )}

      {state.queries && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Searching YouTube for
            {state.briefCached && (
              <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                cached
              </span>
            )}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {state.queries.queries.map((query) => (
              <li
                key={query.q}
                title={query.intent}
                className="rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
              >
                {query.q}
              </li>
            ))}
          </ul>
          {state.queries.avoid.length > 0 && (
            <p className="text-xs text-zinc-500">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                Avoiding:
              </span>{" "}
              {state.queries.avoid.join(", ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
