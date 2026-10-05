"use client";

import { BriefForm } from "./BriefForm";
import { CreatorGrid } from "./CreatorGrid";
import { PipelineStatus } from "./PipelineStatus";
import { useMatchPipeline } from "@/hooks/useMatchPipeline";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";

/** Owns the page state: the form feeds the pipeline, the panels show it. */
export function MatchWorkspace() {
  const { state, run, busy } = useMatchPipeline();

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <BriefForm examples={EXAMPLE_BRIEFS} onValid={run} busy={busy} />
      </section>
      <PipelineStatus state={state} />
      {state.creators && (
        <CreatorGrid
          creators={state.creators}
          totalQueries={state.queries?.queries.length ?? 3}
        />
      )}
    </div>
  );
}
