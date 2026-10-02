"use client";

import type { ExampleBrief } from "@/lib/example-briefs";

interface Props {
  examples: readonly ExampleBrief[];
  onPick: (example: ExampleBrief) => void;
  disabled?: boolean;
}

/** One-click briefs. Picking one fills the form and submits it. */
export function ExampleButtons({ examples, onPick, disabled = false }: Props) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <span className="text-sm text-zinc-600 dark:text-zinc-400">
        Try an example:
      </span>
      <div className="flex flex-wrap gap-2">
        {examples.map((example) => (
          <button
            key={example.slug}
            type="button"
            onClick={() => onPick(example)}
            disabled={disabled}
            title={example.blurb}
            className="rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-800 transition hover:border-zinc-500 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-400 dark:hover:bg-zinc-800"
          >
            {example.title}
          </button>
        ))}
      </div>
    </div>
  );
}
