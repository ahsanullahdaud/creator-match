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
