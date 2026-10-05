"use client";

import { useEffect, useState } from "react";
import { BriefForm } from "./BriefForm";
import { CreatorGrid } from "./CreatorGrid";
import { PipelineStatus } from "./PipelineStatus";
import { QuotaBanner } from "./QuotaBanner";
import { useMatchPipeline } from "@/hooks/useMatchPipeline";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";
import type { StatusResponse } from "@/lib/schemas";

/** Owns the page state: the form feeds the pipeline, the panels show it. */
export function MatchWorkspace() {
  const { state, run, retryScore, busy } = useMatchPipeline();
  const [status, setStatus] = useState<StatusResponse | null>(null);

  // Fetched on load, and again whenever a run finishes, so the banner counts down.
  const settled =
    state.stage === "idle" || state.stage === "done" || state.stage === "error";
  useEffect(() => {
    if (!settled) return;
    let cancelled = false;
    fetch("/api/status", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<StatusResponse>) : null))
      .then((body) => {
        if (!cancelled && body) setStatus(body);
      })
      .catch(() => {
        /* the banner simply stays as it was */
      });
    return () => {
      cancelled = true;
    };
  }, [settled, state.stage]);

  const visitor = state.visitor ?? status?.visitor ?? null;
  const budget = state.budget ?? status?.budget ?? null;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <BriefForm examples={EXAMPLE_BRIEFS} onValid={run} busy={busy} />
      </section>
      <QuotaBanner visitor={visitor} budget={budget} />
      <PipelineStatus state={state} />
      {state.creators && (
        <CreatorGrid
          creators={state.creators}
          totalQueries={state.queries?.queries.length ?? 3}
          scores={state.scores}
          settled={state.stage === "done" || state.stage === "error"}
          onRetry={retryScore}
        />
      )}
    </div>
  );
}
