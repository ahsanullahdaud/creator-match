"use client";

import type { PipelineState } from "@/hooks/useMatchPipeline";

type StepState = "idle" | "running" | "done" | "error";

interface Step {
  key: string;
  label: string;
  state: StepState;
  detail?: string;
}

function steps(state: PipelineState): Step[] {
  const briefState: StepState =
    state.stage === "brief"
      ? "running"
      : state.stage === "done"
        ? "done"
        : state.stage === "error"
          ? "error"
          : "idle";
  const briefDetail =
    briefState === "done" && state.briefMs !== null
      ? `${state.cached ? "from cache" : "generated"} in ${state.briefMs} ms`
      : briefState === "running"
        ? "asking the AI for search queries"
        : undefined;
  return [
    {
      key: "brief",
      label: "Search queries",
      state: briefState,
      detail: briefDetail,
    },
    {
      key: "search",
      label: "YouTube search",
      state: "idle",
      detail: "next build step",
    },
    {
      key: "score",
      label: "Fit scores",
      state: "idle",
      detail: "next build step",
    },
  ];
}

const dotClass: Record<StepState, string> = {
  idle: "bg-zinc-300 dark:bg-zinc-700",
  running: "bg-amber-400 animate-pulse",
  done: "bg-emerald-500",
  error: "bg-red-500",
};

/** The three pipeline stages, the generated queries, and any error. */
export function PipelineStatus({ state }: { state: PipelineState }) {
  if (state.stage === "idle") return null;

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

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          {state.error.message}
        </p>
      )}

      {state.queries && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            What we will search for
            {state.cached && (
              <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                cached
              </span>
            )}
          </h2>
          <ul className="flex flex-col gap-2">
            {state.queries.queries.map((query) => (
              <li
                key={query.q}
                className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
              >
                <p className="font-medium text-zinc-900 dark:text-zinc-100">
                  {query.q}
                </p>
                <p className="text-sm text-zinc-500">{query.intent}</p>
              </li>
            ))}
          </ul>
          {(state.queries.contentThemes.length > 0 ||
            state.queries.avoid.length > 0) && (
            <div className="flex flex-col gap-1 text-xs text-zinc-500">
              {state.queries.contentThemes.length > 0 && (
                <p>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    Themes:
                  </span>{" "}
                  {state.queries.contentThemes.join(", ")}
                </p>
              )}
              {state.queries.avoid.length > 0 && (
                <p>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    Avoid:
                  </span>{" "}
                  {state.queries.avoid.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
