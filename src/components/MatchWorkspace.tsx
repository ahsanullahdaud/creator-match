"use client";

import { useEffect, useState } from "react";
import { BriefForm } from "./BriefForm";
import { CreatorGrid } from "./CreatorGrid";
import { PasscodeDialog } from "./PasscodeDialog";
import { PipelineStatus } from "./PipelineStatus";
import { QuotaBanner } from "./QuotaBanner";
import { useMatchPipeline } from "@/hooks/useMatchPipeline";
import { EXAMPLE_BRIEFS, type ExampleBrief } from "@/lib/example-briefs";
import type { Brief, StatusResponse } from "@/lib/schemas";

/** Owns the page state: the form feeds the pipeline, the panels show it. */
export function MatchWorkspace() {
  const { state, run, retryScore, busy } = useMatchPipeline();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusVersion, setStatusVersion] = useState(0);
  // Remounting the form with new initial values is how an example fills it.
  const [prefill, setPrefill] = useState<{ brief: Brief; key: number } | null>(
    null,
  );

  // Fetched on load, after each run, and after the passcode changes.
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
  }, [settled, state.stage, statusVersion]);

  function pickExample(example: ExampleBrief) {
    setPrefill({ brief: example.brief, key: Date.now() });
    void run(example.brief, "example");
  }

  // Status is refreshed after every run, so it is the fresher of the two.
  const visitor = status?.visitor ?? state.visitor ?? null;
  const budget = status?.budget ?? state.budget ?? null;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <BriefForm
          key={prefill?.key ?? 0}
          initialValues={prefill?.brief}
          examples={EXAMPLE_BRIEFS}
          onValid={run}
          busy={busy}
        />
      </section>
      <div className="flex flex-col gap-2">
        <QuotaBanner visitor={visitor} budget={budget} />
        <div className="flex justify-end px-1">
          <PasscodeDialog
            active={Boolean(visitor?.bypass)}
            onChange={() => setStatusVersion((v) => v + 1)}
          />
        </div>
      </div>
      <PipelineStatus
        state={state}
        examples={EXAMPLE_BRIEFS}
        onPickExample={pickExample}
      />
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
