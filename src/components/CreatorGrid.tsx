"use client";

import { CreatorCard } from "./CreatorCard";
import type { ScoreStatus } from "@/hooks/useMatchPipeline";
import type { Creator } from "@/lib/schemas";

interface Props {
  creators: Creator[];
  totalQueries: number;
  scores: Record<string, ScoreStatus>;
  /** When true, cards are re-ordered by fit score (unscored ones last). */
  settled: boolean;
  onRetry?: (channelId: string) => void;
}

function fitOf(status: ScoreStatus | undefined): number {
  return status?.status === "done" ? status.score.fitScore : -1;
}

/** Placeholder cards shown while YouTube is being searched. */
export function CreatorGridSkeleton({ count = 4 }: { count?: number }) {
  const bar = "animate-pulse rounded bg-zinc-200 dark:bg-zinc-800";
  return (
    <ul
      aria-busy
      aria-label="Loading channels"
      className="grid gap-3 sm:grid-cols-2"
    >
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="flex items-start gap-3">
            <div className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="flex flex-1 flex-col gap-2 pt-1">
              <div className={`h-4 w-2/3 ${bar}`} />
              <div className={`h-3 w-1/3 ${bar}`} />
              <div className={`h-3 w-1/2 ${bar}`} />
            </div>
          </div>
          <div className={`h-3 w-5/6 ${bar}`} />
          <div className={`h-3 w-3/4 ${bar}`} />
        </li>
      ))}
    </ul>
  );
}

export function CreatorGrid({
  creators,
  totalQueries,
  scores,
  settled,
  onRetry,
}: Props) {
  if (creators.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        No channels in the chosen size range matched these searches. Try
        &ldquo;Any size&rdquo; or a different region.
      </p>
    );
  }
  const ordered = settled
    ? [...creators].sort(
        (a, b) => fitOf(scores[b.channelId]) - fitOf(scores[a.channelId]),
      )
    : creators;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {ordered.map((creator, index) => (
        <CreatorCard
          key={creator.channelId}
          creator={creator}
          rank={index + 1}
          totalQueries={totalQueries}
          score={scores[creator.channelId]}
          onRetry={onRetry}
        />
      ))}
    </ul>
  );
}
