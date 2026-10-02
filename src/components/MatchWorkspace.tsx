"use client";

import { useState } from "react";
import { BriefForm, type BriefSource } from "./BriefForm";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";
import type { Brief } from "@/lib/schemas";

interface Submitted {
  brief: Brief;
  source: BriefSource;
}

/** Owns the page state. Step 6 replaces the log and preview with the pipeline. */
export function MatchWorkspace() {
  const [submitted, setSubmitted] = useState<Submitted | null>(null);

  function handleValid(brief: Brief, source: BriefSource) {
    console.log("brief", { source, brief });
    setSubmitted({ brief, source });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <BriefForm examples={EXAMPLE_BRIEFS} onValid={handleValid} />
      </section>

      {submitted && (
        <section
          aria-live="polite"
          className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-6 dark:border-emerald-900 dark:bg-emerald-950/40"
        >
          <h2 className="text-base font-semibold text-emerald-900 dark:text-emerald-100">
            Brief ready{submitted.source === "example" ? " (example)" : ""}
          </h2>
          <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
            Validated and normalized. The next build step sends this to Claude
            for search queries.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-white/70 p-3 font-mono text-xs leading-5 text-zinc-800 dark:bg-black/30 dark:text-zinc-200">
            {JSON.stringify(submitted.brief, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
